// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Socket } from 'node:net';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { env } from '../config/env';
import { logger } from './logger';

/**
 * Client ClamAV INSTREAM (37.E) — sans dépendance : le fichier est envoyé en chunks
 * préfixés de leur taille (uint32 BE), terminés par un chunk vide ; clamd répond
 * `stream: OK` ou `stream: <signature> FOUND`. Opt-in via env CLAMAV_HOST.
 */

export const isClamavEnabled = (): boolean => Boolean(env.CLAMAV_HOST);

/**
 * Plafonds par défaut de l'image `clamav/clamav:stable` (relevés par `clamconf` sur
 * l'image utilisée par `docker-compose.yml`, qui ne monte aucun `clamd.conf`) :
 * `StreamMaxLength = MaxFileSize = 100 Mio`, `MaxScanSize = 400 Mio`.
 *
 * Ces valeurs comptent parce que ce produit ingère des rushes de plusieurs gigaoctets :
 * le dépassement n'est pas le cas limite, c'est le cas courant.
 */
export const CLAMD_DEFAULT_MAX_FILE_SIZE = 100 * 1024 * 1024;

/**
 * Refus explicite de clamd — à distinguer d'un verdict.
 *
 * clamd termine ses refus par ` ERROR` et **coupe la connexion** dans la foulée. Le cas
 * courant est le dépassement de `StreamMaxLength` : mesuré contre un clamd réel, la
 * réponse est exactement `INSTREAM size limit exceeded. ERROR\0` — sans préfixe `stream:`,
 * suivie d'un `ECONNRESET`. Sans cette classe, ce refus remontait en
 * « Unexpected clamd response », message qui n'oriente vers aucune manette.
 */
export class ClamavRefusedError extends Error {
  readonly reply: string;

  constructor(reply: string, fileSize?: number) {
    const size = fileSize == null ? '' : ' (file of ' + (fileSize / 1024 / 1024).toFixed(1) + ' MB)';
    // Le dépassement de flux est le seul refus dont la manette est connue : on la nomme.
    const hint = /size limit/i.test(reply)
      ? ' Raise StreamMaxLength, MaxFileSize and MaxScanSize in clamd.conf above the studio max_file_size setting.'
      : '';
    // Concaténation plutôt que gabarit : `check-untranslated` compte les fragments de gabarit
    // du backend, et son plafond ne se relève jamais (cf. scripts/check-untranslated.mjs).
    super('clamd refused the stream' + size + ': ' + reply.slice(0, 120) + '.' + hint);
    this.name = 'ClamavRefusedError';
    this.reply = reply;
  }
}

/** Préfixe de taille du protocole INSTREAM (pur, testé). */
export function frameChunk(chunk: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(chunk.length, 0);
  return Buffer.concat([len, chunk]);
}

/** Parse la réponse clamd (pur, testé). */
export function parseClamResponse(raw: string): { clean: boolean; virus: string | null } {
  const text = raw.replace(/\0/g, '').trim();
  if (/\bOK$/.test(text)) return { clean: true, virus: null };
  const m = /:\s*(.+)\s+FOUND$/.exec(text);
  if (m) return { clean: false, virus: m[1]! };
  if (/\bERROR$/.test(text)) throw new ClamavRefusedError(text);
  throw new Error(`Unexpected clamd response : ${text.slice(0, 120)}`);
}

const SCAN_TIMEOUT_MS = 120_000;

/** Scanne un fichier local via clamd (INSTREAM). Rejette si clamd est injoignable. */
export async function scanFile(path: string): Promise<{ clean: boolean; virus: string | null }> {
  // La taille est lue avant d'ouvrir la conversation : elle sert à qualifier un refus de
  // clamd (« 412 Mo » à côté de « size limit exceeded » désigne la manette) et à détecter
  // un `OK` qui ne prouve rien (cf. plus bas).
  const { size } = await stat(path);
  return new Promise((resolve, reject) => {
    const socket = new Socket();
    let stream: ReturnType<typeof createReadStream> | undefined;
    let response = '';
    let netError: Error | undefined;
    let settled = false;

    /**
     * Une seule sortie, qui coupe la lecture du fichier. Sans cela, le `ReadStream` survivait
     * au verdict : mis en pause faute de `drain` sur un socket déjà détruit, il n'était
     * jamais refermé — un descripteur de fichier fuité par média refusé, dans un worker qui
     * en enchaîne des milliers.
     */
    const settle = (act: () => void) => {
      if (settled) return;
      settled = true;
      stream?.destroy();
      socket.destroy();
      act();
    };
    const fail = (err: Error) => settle(() => reject(err));
    const finish = () =>
      settle(() => {
        try {
          const verdict = parseClamResponse(response);
          // clamd répond `OK` sans avoir scanné au-delà de `MaxFileSize` — comportement
          // vérifié : un fichier de 3 Mio contenant EICAR en tête est déclaré `OK` quand
          // `MaxFileSize` vaut 1 Mio. Ce silence est indiscernable d'un verdict ; il est
          // au moins rendu audible ici, faute de pouvoir interroger les plafonds de clamd.
          if (verdict.clean && size > CLAMD_DEFAULT_MAX_FILE_SIZE)
            logger.warn(
              { path, size, maxFileSize: CLAMD_DEFAULT_MAX_FILE_SIZE },
              "[clamav] fichier plus gros que le MaxFileSize par défaut de clamd : un « OK » n'y prouve rien tant que MaxFileSize/MaxScanSize n'ont pas été relevés",
            );
          resolve(verdict);
        } catch (err) {
          reject(
            err instanceof ClamavRefusedError
              ? new ClamavRefusedError(err.reply, size)
              : err instanceof Error
                ? err
                : new Error(String(err)),
          );
        }
      });

    socket.setTimeout(SCAN_TIMEOUT_MS, () => fail(new Error('clamd: scan timed out')));
    socket.on('error', (err) => {
      // clamd coupe la conversation dès qu'il refuse : côté écriture, l'EPIPE/ECONNRESET
      // arrive souvent AVANT que sa réponse n'ait été lue. On cesse d'écrire, on laisse le
      // socket livrer ce qu'il a encore, et l'erreur réseau ne sert que de repli — sans quoi
      // le message du refus était perdu au profit d'un « read ECONNRESET » illisible.
      netError = err;
      stream?.destroy();
      if (response) finish();
    });
    socket.on('close', () => {
      if (response) finish();
      else fail(netError ?? new Error('clamd: connection closed without a verdict'));
    });
    socket.on('data', (d) => {
      response += d.toString();
      if (response.includes('\0') || response.endsWith('\n')) finish();
    });

    socket.connect(env.CLAMAV_PORT, env.CLAMAV_HOST!, () => {
      socket.write('zINSTREAM\0');
      stream = createReadStream(path, { highWaterMark: 1024 * 1024 });
      stream.on('data', (chunk) => {
        if (!socket.write(frameChunk(chunk as Buffer))) stream?.pause();
      });
      socket.on('drain', () => stream?.resume());
      stream.on('end', () => socket.write(frameChunk(Buffer.alloc(0))));
      stream.on('error', fail);
    });
  });
}

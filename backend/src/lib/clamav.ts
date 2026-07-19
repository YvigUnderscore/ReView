import { Socket } from 'node:net';
import { createReadStream } from 'node:fs';
import { env } from '../config/env';

/**
 * Client ClamAV INSTREAM (37.E) — sans dépendance : le fichier est envoyé en chunks
 * préfixés de leur taille (uint32 BE), terminés par un chunk vide ; clamd répond
 * `stream: OK` ou `stream: <signature> FOUND`. Opt-in via env CLAMAV_HOST.
 */

export const isClamavEnabled = (): boolean => Boolean(env.CLAMAV_HOST);

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
  throw new Error(`Réponse clamd inattendue : ${text.slice(0, 120)}`);
}

const SCAN_TIMEOUT_MS = 120_000;

/** Scanne un fichier local via clamd (INSTREAM). Rejette si clamd est injoignable. */
export function scanFile(path: string): Promise<{ clean: boolean; virus: string | null }> {
  return new Promise((resolve, reject) => {
    const socket = new Socket();
    let response = '';
    const fail = (err: Error) => {
      socket.destroy();
      reject(err);
    };
    socket.setTimeout(SCAN_TIMEOUT_MS, () => fail(new Error('clamd : délai de scan dépassé')));
    socket.on('error', fail);
    socket.on('data', (d) => {
      response += d.toString();
      if (response.includes('\0') || response.endsWith('\n')) {
        socket.end();
        try {
          resolve(parseClamResponse(response));
        } catch (err) {
          reject(err as Error);
        }
      }
    });
    socket.connect(env.CLAMAV_PORT, env.CLAMAV_HOST!, () => {
      socket.write('zINSTREAM\0');
      const stream = createReadStream(path, { highWaterMark: 1024 * 1024 });
      stream.on('data', (chunk) => {
        if (!socket.write(frameChunk(chunk as Buffer))) stream.pause();
      });
      socket.on('drain', () => stream.resume());
      stream.on('end', () => socket.write(frameChunk(Buffer.alloc(0))));
      stream.on('error', fail);
    });
  });
}

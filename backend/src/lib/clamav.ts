// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Socket } from 'node:net';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { env } from '../config/env';
import { logger } from './logger';

/**
 * ClamAV INSTREAM client (37.E), dependency-free: the file is sent in chunks prefixed by their size
 * (uint32 BE), terminated by an empty chunk; clamd answers `stream: OK` or `stream: <signature> FOUND`.
 * Opt-in via the CLAMAV_HOST env variable.
 */

export const isClamavEnabled = (): boolean => Boolean(env.CLAMAV_HOST);

/**
 * Default limits of the `clamav/clamav:stable` image (read by `clamconf` on the image used by
 * `docker-compose.yml`, which mounts no `clamd.conf`):
 * `StreamMaxLength = MaxFileSize = 100 MiB`, `MaxScanSize = 400 MiB`.
 *
 * These values matter because this product ingests rushes of several gigabytes: exceeding them is
 * not the edge case, it is the common case.
 */
export const CLAMD_DEFAULT_MAX_FILE_SIZE = 100 * 1024 * 1024;

/**
 * Explicit refusal from clamd, to be distinguished from a verdict.
 *
 * clamd ends its refusals with ` ERROR` and **cuts the connection** straight after. The common case
 * is exceeding `StreamMaxLength`: measured against a real clamd, the reply is exactly
 * `INSTREAM size limit exceeded. ERROR\0`, without a `stream:` prefix, followed by an `ECONNRESET`.
 * Without this class, that refusal surfaced as "Unexpected clamd response", a message pointing to no
 * setting.
 */
export class ClamavRefusedError extends Error {
  readonly reply: string;

  constructor(reply: string, fileSize?: number) {
    const size = fileSize == null ? '' : ' (file of ' + (fileSize / 1024 / 1024).toFixed(1) + ' MB)';
    // Stream overflow is the only refusal whose setting is known: name it.
    const hint = /size limit/i.test(reply)
      ? ' Raise StreamMaxLength, MaxFileSize and MaxScanSize in clamd.conf above the studio max_file_size setting.'
      : '';
    // Concatenation rather than a template: `check-untranslated` counts the backend's template
    // fragments, and its ceiling is never raised (cf. scripts/check-untranslated.mjs).
    super('clamd refused the stream' + size + ': ' + reply.slice(0, 120) + '.' + hint);
    this.name = 'ClamavRefusedError';
    this.reply = reply;
  }
}

/** Size prefix of the INSTREAM protocol (pure, tested). */
export function frameChunk(chunk: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(chunk.length, 0);
  return Buffer.concat([len, chunk]);
}

/** Parses the clamd response (pure, tested). */
export function parseClamResponse(raw: string): { clean: boolean; virus: string | null } {
  const text = raw.replace(/\0/g, '').trim();
  if (/\bOK$/.test(text)) return { clean: true, virus: null };
  const m = /:\s*(.+)\s+FOUND$/.exec(text);
  if (m) return { clean: false, virus: m[1]! };
  if (/\bERROR$/.test(text)) throw new ClamavRefusedError(text);
  throw new Error(`Unexpected clamd response : ${text.slice(0, 120)}`);
}

const SCAN_TIMEOUT_MS = 120_000;

/** Scans a local file via clamd (INSTREAM). Rejects if clamd is unreachable. */
export async function scanFile(path: string): Promise<{ clean: boolean; virus: string | null }> {
  // The size is read before opening the conversation: it qualifies a refusal from clamd ("412 MB"
  // next to "size limit exceeded" points to the setting) and detects an `OK` that proves nothing
  // (see below).
  const { size } = await stat(path);
  return new Promise((resolve, reject) => {
    const socket = new Socket();
    let stream: ReturnType<typeof createReadStream> | undefined;
    let response = '';
    let netError: Error | undefined;
    let settled = false;

    /**
     * A single exit, which cuts off reading the file. Without it, the `ReadStream` survived the verdict:
     * paused for lack of `drain` on an already destroyed socket, it was never closed again — a file
     * descriptor leaked per refused media, in a worker processing thousands.
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
          // clamd answers `OK` without having scanned beyond `MaxFileSize`: verified behaviour, a 3 MiB
          // file with EICAR at its head is reported `OK` when `MaxFileSize` is 1 MiB. This silence is
          // indistinguishable from a verdict; it is at least made audible here, since clamd's limits
          // cannot be queried.
          if (verdict.clean && size > CLAMD_DEFAULT_MAX_FILE_SIZE)
            logger.warn(
              { path, size, maxFileSize: CLAMD_DEFAULT_MAX_FILE_SIZE },
              '[clamav] file larger than the default clamd MaxFileSize: an "OK" proves nothing until MaxFileSize/MaxScanSize are raised',
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
      // clamd cuts the conversation as soon as it refuses: on the write side, EPIPE/ECONNRESET often
      // arrives BEFORE its reply has been read. We stop writing and let the socket deliver what it
      // still has; the network error is only a fallback — otherwise the refusal message was lost in
      // favour of an unreadable "read ECONNRESET".
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

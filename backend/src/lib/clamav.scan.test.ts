// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createServer, type Server, type Socket } from 'node:net';
import { mkdtempSync, writeFileSync, truncateSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const config = { host: '127.0.0.1', port: 0 };
vi.mock('../config/env', () => ({
  env: {
    get CLAMAV_HOST() {
      return config.host;
    },
    get CLAMAV_PORT() {
      return config.port;
    },
  },
}));
vi.mock('./logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

/**
 * Descriptors opened by `scanFile`, and bytes actually read from disk.
 *
 * This is the measure of the fix. When clamd refuses, it cuts the connection; the old client destroyed
 * the socket but **never** its `ReadStream`. The stream, paused for lack of `drain` on a dead socket,
 * lived on indefinitely: a file descriptor leaked per refused media, in a worker processing thousands.
 * The `data` listener below consumes nothing: `scanFile` attaches its own right after, both receive
 * the same chunks.
 */
let bytesRead = 0;
let opened: { destroyed: boolean }[] = [];
vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>();
  return {
    ...real,
    createReadStream: (...args: Parameters<typeof real.createReadStream>) => {
      const stream = real.createReadStream(...args);
      opened.push(stream);
      stream.on('data', (chunk) => {
        bytesRead += (chunk as Buffer).length;
      });
      return stream;
    },
  };
});

import { scanFile } from './clamav';
import { logger } from './logger';

/** Fake clamd: answers as soon as the `zINSTREAM` command arrives, like the real one does when refusing. */
type Mode = 'refuse-size' | 'ok' | 'reset-silently' | 'ok-after-eof';

let server: Server | undefined;
let dir = '';

function startFakeClamd(mode: Mode): Promise<void> {
  return new Promise((resolve) => {
    server = createServer((sock: Socket) => {
      let answered = false;
      let total = 0;
      let tail = Buffer.alloc(0);
      sock.on('error', () => undefined);
      sock.on('data', (d) => {
        total += d.length;
        if (mode === 'ok-after-eof') {
          tail = Buffer.concat([tail, d]).subarray(-4);
          // INSTREAM terminator: a zero-length prefix at the end of the stream.
          if (total > 10 && tail.length === 4 && tail.every((b) => b === 0)) sock.end('stream: OK\0');
          return;
        }
        if (answered) return;
        answered = true;
        if (mode === 'reset-silently') return sock.destroy();
        const reply = mode === 'refuse-size' ? 'INSTREAM size limit exceeded. ERROR\0' : 'stream: OK\0';
        // Refusal then abrupt cut-off: behaviour observed on a real clamd.
        sock.write(reply, () => sock.destroy());
      });
    });
    server.listen(0, '127.0.0.1', () => {
      config.port = (server!.address() as { port: number }).port;
      resolve();
    });
  });
}

function fileOf(name: string, bytes: number, sparse = false): string {
  const path = join(dir, name);
  if (sparse) {
    writeFileSync(path, Buffer.alloc(0));
    truncateSync(path, bytes);
  } else writeFileSync(path, Buffer.alloc(bytes, 0x41));
  return path;
}

beforeEach(() => {
  vi.clearAllMocks();
  bytesRead = 0;
  opened = [];
  dir = mkdtempSync(join(tmpdir(), 'clamav-scan-'));
});

afterEach(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  server = undefined;
  rmSync(dir, { recursive: true, force: true });
});

describe('scanFile — clamd refusal', () => {
  it('makes the size refusal readable, instead of "unexpected response" or an ECONNRESET', async () => {
    await startFakeClamd('refuse-size');
    const path = fileOf('master.mov', 4 * 1024 * 1024);

    await expect(scanFile(path)).rejects.toThrow(/StreamMaxLength/);
    await expect(scanFile(path)).rejects.toThrow(/size limit exceeded/);
    // The file size travels with the message: the administrator sees the limit.
    await expect(scanFile(path)).rejects.toThrow(/4\.0 MB/);
  });

  it('closes the file as soon as clamd has answered: no leaked descriptor', async () => {
    await startFakeClamd('refuse-size');
    const size = 8 * 1024 * 1024;
    const path = fileOf('rush.mov', size);

    await expect(scanFile(path)).rejects.toThrow();
    // Measured AFTER letting the event loop run: without the fix, the stream stayed paused, never
    // destroyed — `destroyed` stayed `false` forever.
    await new Promise((r) => setTimeout(r, 300));
    expect(opened).toHaveLength(1);
    expect(opened.filter((s) => !s.destroyed)).toEqual([]);
    // Nor did it flush the whole file into a dead socket.
    expect(bytesRead).toBeLessThan(size);
  });

  it('does not report anything healthy when clamd cuts off without answering', async () => {
    await startFakeClamd('reset-silently');
    const path = fileOf('rush.mov', 1024);

    await expect(scanFile(path)).rejects.toThrow();
  });
});

describe('scanFile — verdicts', () => {
  it('returns clamd\'s verdict after sending the whole file', async () => {
    await startFakeClamd('ok-after-eof');
    const path = fileOf('plan.png', 1024);

    await expect(scanFile(path)).resolves.toEqual({ clean: true, virus: null });
    expect(bytesRead).toBe(1024);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  /**
   * clamd answers `OK` without having scanned beyond `MaxFileSize`: checked against a real clamd
   * (`MaxFileSize 1M`), a 3 MiB file with EICAR at its head is reported `OK`.
   * Silence is indistinguishable from a verdict; at least it is made audible.
   */
  it('signals that an OK proves nothing beyond clamd\'s default MaxFileSize', async () => {
    await startFakeClamd('ok');
    const path = fileOf('master.exr', 101 * 1024 * 1024, true);

    await expect(scanFile(path)).resolves.toEqual({ clean: true, virus: null });
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(vi.mocked(logger.warn).mock.calls[0]?.[1]).toMatch(/MaxFileSize/);
  });
});

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
 * Descripteurs ouverts par `scanFile`, et octets réellement lus sur le disque.
 *
 * C'est la mesure du correctif. Quand clamd refuse, il coupe la connexion ; l'ancien client
 * détruisait le socket mais **jamais** son `ReadStream`. Le flux, mis en pause faute de
 * `drain` sur un socket mort, restait en vie indéfiniment : un descripteur de fichier fuité
 * à chaque média refusé, dans un worker qui en enchaîne des milliers. L'écouteur `data`
 * ci-dessous ne consomme rien — `scanFile` attache le sien immédiatement après, les deux
 * reçoivent les mêmes chunks.
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

/** clamd de paille : répond dès la commande `zINSTREAM`, comme le vrai quand il refuse. */
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
          // Terminateur INSTREAM : un préfixe de longueur nulle en fin de flux.
          if (total > 10 && tail.length === 4 && tail.every((b) => b === 0)) sock.end('stream: OK\0');
          return;
        }
        if (answered) return;
        answered = true;
        if (mode === 'reset-silently') return sock.destroy();
        const reply = mode === 'refuse-size' ? 'INSTREAM size limit exceeded. ERROR\0' : 'stream: OK\0';
        // Refus puis coupure sèche : comportement relevé au fil sur un vrai clamd.
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

describe('scanFile — refus de clamd', () => {
  it('rend le refus de taille lisible, au lieu de « réponse inattendue » ou d’un ECONNRESET', async () => {
    await startFakeClamd('refuse-size');
    const path = fileOf('master.mov', 4 * 1024 * 1024);

    await expect(scanFile(path)).rejects.toThrow(/StreamMaxLength/);
    await expect(scanFile(path)).rejects.toThrow(/size limit exceeded/);
    // La taille du fichier voyage avec le message : l'administrateur voit le lien.
    await expect(scanFile(path)).rejects.toThrow(/4\.0 MB/);
  });

  it('referme le fichier dès que clamd a répondu : aucun descripteur fuité', async () => {
    await startFakeClamd('refuse-size');
    const size = 8 * 1024 * 1024;
    const path = fileOf('rush.mov', size);

    await expect(scanFile(path)).rejects.toThrow();
    // Mesure prise APRÈS avoir laissé tourner la boucle d'événements : sans le correctif,
    // le flux restait en pause, jamais détruit — `destroyed` valait `false` pour toujours.
    await new Promise((r) => setTimeout(r, 300));
    expect(opened).toHaveLength(1);
    expect(opened.filter((s) => !s.destroyed)).toEqual([]);
    // Et il n'a pas non plus vidé le fichier entier dans un socket mort.
    expect(bytesRead).toBeLessThan(size);
  });

  it('ne déclare rien de sain quand clamd coupe sans répondre', async () => {
    await startFakeClamd('reset-silently');
    const path = fileOf('rush.mov', 1024);

    await expect(scanFile(path)).rejects.toThrow();
  });
});

describe('scanFile — verdicts', () => {
  it('rend le verdict de clamd après avoir envoyé tout le fichier', async () => {
    await startFakeClamd('ok-after-eof');
    const path = fileOf('plan.png', 1024);

    await expect(scanFile(path)).resolves.toEqual({ clean: true, virus: null });
    expect(bytesRead).toBe(1024);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  /**
   * clamd répond `OK` sans avoir scanné au-delà de `MaxFileSize` : vérifié contre un vrai
   * clamd (`MaxFileSize 1M`), un fichier de 3 Mio portant EICAR en tête est déclaré `OK`.
   * Le silence est indiscernable du verdict ; il est au moins rendu audible.
   */
  it('signale qu’un OK ne prouve rien au-delà du MaxFileSize par défaut de clamd', async () => {
    await startFakeClamd('ok');
    const path = fileOf('master.exr', 101 * 1024 * 1024, true);

    await expect(scanFile(path)).resolves.toEqual({ clean: true, virus: null });
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(vi.mocked(logger.warn).mock.calls[0]?.[1]).toMatch(/MaxFileSize/);
  });
});

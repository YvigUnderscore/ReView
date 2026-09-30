// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { sha256File } from './checksum';

describe('sha256File', () => {
  it('hash identique à un hash mémoire', async () => {
    const p = join(tmpdir(), `checksum-test-${Date.now()}.bin`);
    const data = Buffer.from('contenu de test ReView 37.B');
    await writeFile(p, data);
    try {
      await expect(sha256File(p)).resolves.toBe(createHash('sha256').update(data).digest('hex'));
    } finally {
      await rm(p, { force: true });
    }
  });

  it('rejette si le fichier est absent', async () => {
    await expect(sha256File(join(tmpdir(), 'inexistant-xyz.bin'))).rejects.toBeTruthy();
  });
});

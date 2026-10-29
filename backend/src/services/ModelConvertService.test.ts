// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import AdmZip from 'adm-zip';
import { mkdtemp, rm, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { convertToGlb } from './ModelConvertService';

/**
 * Conversion paths verifiable **without an external binary**: the direct copy of a GLB and the hardening of
 * archive extraction (45.A, wired into the service). The Blender/assimp
 * paths fall under end-to-end verification (45.G), not unit tests.
 */

let root: string;

/** Isolated folder per test: extraction writes into `<archive folder>/unzipped`. */
async function workspace(): Promise<string> {
  return mkdtemp(join(root, 'case-'));
}

/**
 * adm-zip sanitises the names passed to `addFile`: it is impossible to create a traversing entry there.
 * We therefore write a name of **the same length** and then patch it in the bytes — the zip offsets remain
 * valid and the CRC only covers the content, not the name.
 */
function zipWithEntryName(entryName: string, placeholder: string, content: string): Buffer {
  const zip = new AdmZip();
  zip.addFile(placeholder, Buffer.from(content));
  const raw = zip.toBuffer().toString('latin1').split(placeholder).join(entryName);
  return Buffer.from(raw, 'latin1');
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'review-convert-test-'));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('convertToGlb', () => {
  it('copies a .glb as is without invoking any converter', async () => {
    const dir = await workspace();
    const src = join(dir, 'src.glb');
    const out = join(dir, 'out.glb');
    await writeFile(src, Buffer.from('glTF binaire factice'));

    expect(await convertToGlb(src, out, '.glb')).toEqual({ converter: 'copy' });
    expect((await stat(out)).size).toBeGreaterThan(0);
  });

  it('refuses an archive containing an entry that leaves the target folder', async () => {
    const dir = await workspace();
    const zipPath = join(dir, 'traversal.zip');
    await writeFile(zipPath, zipWithEntryName('../evil.sh', 'xx/evil.sh', 'rm -rf /'));

    await expect(convertToGlb(zipPath, join(dir, 'a.glb'), '.zip')).rejects.toThrow(/sortant de l'archive/);
  });

  it('refuses an archive lacking any recognised 3D file', async () => {
    const dir = await workspace();
    const zipPath = join(dir, 'nothing.zip');
    const zip = new AdmZip();
    zip.addFile('README.md', Buffer.from('rien de 3D ici'));
    zip.writeZip(zipPath);

    await expect(convertToGlb(zipPath, join(dir, 'b.glb'), '.zip')).rejects.toThrow(
      /Aucun fichier 3D reconnu/,
    );
  });
});

// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import AdmZip from 'adm-zip';
import { mkdtemp, rm, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { extractArchive } from './ModelConvertService';

/**
 * Extraction d'archive : `lib/zipSafety` juge le CATALOGUE (noms et tailles *déclarées*),
 * ces tests vérifient ce qui est réellement écrit sur le disque du worker.
 */

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'review-zip-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const archivePath = async (name: string, build: (zip: AdmZip) => void | Promise<void>) => {
  const zip = new AdmZip();
  await build(zip);
  const p = join(dir, name);
  await writeFile(p, zip.toBuffer());
  return p;
};

describe('extractArchive', () => {
  it('extrait une archive honnête, arborescence comprise', async () => {
    const src = await archivePath('honest.zip', (zip) => {
      zip.addFile('scene.usda', Buffer.from('#usda 1.0\n'));
      zip.addFile('tex/albedo.bin', Buffer.alloc(2048, 7));
    });
    const dest = join(dir, 'out-honest');
    await extractArchive(src, dest);
    expect(await readFile(join(dest, 'scene.usda'), 'utf8')).toBe('#usda 1.0\n');
    expect((await readFile(join(dest, 'tex/albedo.bin'))).length).toBe(2048);
  });

  // Le cœur du correctif : le catalogue est fourni par l'attaquant. Une entrée qui annonce
  // 16 octets et en contient 4 Mo passait tous les contrôles de `planExtraction` (tailles et
  // ratio déclarés), puis `extractAllTo` écrivait les octets réels sans rien vérifier.
  it('refuse une entrée dont la taille réelle dément la taille annoncée', async () => {
    const honest = new AdmZip();
    honest.addFile('big.bin', Buffer.alloc(4 * 1024 * 1024, 0));
    const forged = new AdmZip(honest.toBuffer());
    forged.getEntries()[0]!.header.size = 16; // mensonge du catalogue
    const src = join(dir, 'liar.zip');
    await writeFile(src, forged.toBuffer());

    const dest = join(dir, 'out-liar');
    await expect(extractArchive(src, dest)).rejects.toThrow(/Extraction de l'archive échouée/);
  });

  it('ne laisse aucune extraction partielle derrière un refus', async () => {
    const honest = new AdmZip();
    honest.addFile('ok.txt', Buffer.from('bien'));
    honest.addFile('big.bin', Buffer.alloc(2 * 1024 * 1024, 0));
    const forged = new AdmZip(honest.toBuffer());
    forged.getEntries().find((e) => e.entryName === 'big.bin')!.header.size = 8;
    const src = join(dir, 'partial.zip');
    await writeFile(src, forged.toBuffer());

    const dest = join(dir, 'out-partial');
    await expect(extractArchive(src, dest)).rejects.toThrow();
    // Une scène USD à moitié extraite produirait un modèle silencieusement incomplet.
    await expect(readdir(dest)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  // La traversée de chemin (`../`, chemins absolus, symlinks) n'est pas testée ici : adm-zip
  // normalise les noms à la *création*, on ne peut donc pas fabriquer l'archive hostile avec
  // sa propre API. Ces cas sont couverts unitairement dans `lib/zipSafety.test.ts`, sur les
  // deux fonctions que la boucle d'extraction applique à chaque entrée — `planExtraction`
  // (refus du catalogue) et `resolveInside` (destination réellement écrite).
});

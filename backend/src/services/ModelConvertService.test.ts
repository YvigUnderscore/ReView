import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import AdmZip from 'adm-zip';
import { mkdtemp, rm, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { convertToGlb } from './ModelConvertService';

/**
 * Chemins de conversion vérifiables **sans binaire externe** : la copie directe d'un GLB et le
 * durcissement de l'extraction d'archive (45.A branché sur le service). Les chemins Blender/assimp
 * relèvent de la vérification bout-en-bout (45.G), pas des tests unitaires.
 */

let root: string;

/** Répertoire isolé par test : l'extraction écrit dans `<dossier de l'archive>/unzipped`. */
async function workspace(): Promise<string> {
  return mkdtemp(join(root, 'case-'));
}

/**
 * adm-zip assainit les noms passés à `addFile` : impossible d'y créer une entrée en traversée.
 * On écrit donc un nom de **même longueur** puis on le corrige dans les octets — les offsets du
 * zip restent valides et le CRC ne porte que sur le contenu, pas sur le nom.
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
  it('copie un .glb tel quel sans invoquer de convertisseur', async () => {
    const dir = await workspace();
    const src = join(dir, 'src.glb');
    const out = join(dir, 'out.glb');
    await writeFile(src, Buffer.from('glTF binaire factice'));

    expect(await convertToGlb(src, out, '.glb')).toEqual({ converter: 'copy' });
    expect((await stat(out)).size).toBeGreaterThan(0);
  });

  it('refuse une archive dont une entrée sort du répertoire cible', async () => {
    const dir = await workspace();
    const zipPath = join(dir, 'traversal.zip');
    await writeFile(zipPath, zipWithEntryName('../evil.sh', 'xx/evil.sh', 'rm -rf /'));

    await expect(convertToGlb(zipPath, join(dir, 'a.glb'), '.zip')).rejects.toThrow(/sortant de l'archive/);
  });

  it('refuse une archive dépourvue de fichier 3D reconnu', async () => {
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

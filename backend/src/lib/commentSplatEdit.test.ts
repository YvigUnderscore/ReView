// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { MAX_SPLAT_EDIT_BLOB_BYTES, assertSplatEditBlobs, splatEditBlobKeys } from './commentSplatEdit';

/**
 * Les deux binaires d'une proposition d'édition de nuage voyagent comme des pièces jointes du
 * commentaire, et la part n'en porte que la clé. Ce fichier tient les trois garanties qui
 * rendent ce choix défendable : on sait quelles clés une annotation référence (donc la purge
 * les voit), une référence hors liste de pièces jointes est refusée (donc rien ne fuit et rien
 * n'appartient à autrui), et le plafond de taille est vérifié plutôt que déclaré.
 */
const MASK = 'comments/attachments/7/splat-mask.bin';
const SUBSET = 'comments/attachments/7/splat-subset.bin';
const part = (over: Record<string, unknown> = {}) => [
  { type: 'splat-edit', transform: null, volumes: [], mask: { key: MASK, count: 3 }, ...over },
];

describe('splatEditBlobKeys — ce que la purge doit voir', () => {
  it('relève les deux clés de la part', () => {
    const keys = splatEditBlobKeys(part({ subset: { key: SUBSET, count: 1 } }));
    expect(keys.sort()).toEqual([MASK, SUBSET].sort());
  });

  it('ne rend rien quand il n’y a pas de proposition, ou pas de binaire', () => {
    expect(splatEditBlobKeys(null)).toEqual([]);
    expect(splatEditBlobKeys([{ type: 'rect' }])).toEqual([]);
    expect(splatEditBlobKeys(part({ mask: null }))).toEqual([]);
  });

  it('ne suppose rien de la forme : la colonne est du JSON libre', () => {
    expect(splatEditBlobKeys('nope')).toEqual([]);
    expect(splatEditBlobKeys([null, 42, { type: 'splat-edit', mask: 'AAAA' }])).toEqual([]);
    expect(splatEditBlobKeys(part({ mask: { count: 3 } }))).toEqual([]);
  });

  it('dédoublonne : une même clé citée deux fois ne se purge pas deux fois', () => {
    expect(splatEditBlobKeys(part({ subset: { key: MASK, count: 1 } }))).toEqual([MASK]);
  });
});

describe('assertSplatEditBlobs — la référence doit être une pièce jointe, et tenir', () => {
  const stat = (size: number) => vi.fn().mockResolvedValue({ size });

  it('laisse passer une proposition dont le blob est joint et sous le plafond', async () => {
    const statObject = stat(1_000);
    await expect(
      assertSplatEditBlobs(part(), { attachedKeys: [MASK], stat: statObject }),
    ).resolves.toBeUndefined();
    expect(statObject).toHaveBeenCalledWith(MASK);
  });

  it('ne touche pas au stockage quand il n’y a rien à vérifier', async () => {
    const statObject = stat(1_000);
    await assertSplatEditBlobs([{ type: 'rect' }], { attachedKeys: [], stat: statObject });
    expect(statObject).not.toHaveBeenCalled();
  });

  /**
   * Le refus qui ferme deux portes d'un coup : une clé qui n'est pas dans les pièces jointes du
   * commentaire n'appartient à personne de sûr (la liste, elle, est filtrée par préfixe) et rien
   * ne la ramasserait à la suppression.
   */
  it('refuse une référence qui n’est pas une pièce jointe du commentaire', async () => {
    await expect(assertSplatEditBlobs(part(), { attachedKeys: [], stat: stat(10) })).rejects.toMatchObject({
      statusCode: 400,
      code: 'SPLAT_EDIT_UNATTACHED',
    });
    await expect(
      assertSplatEditBlobs(part({ mask: { key: 'comments/attachments/9/splat-mask.bin', count: 3 } }), {
        attachedKeys: [MASK],
        stat: stat(10),
      }),
    ).rejects.toMatchObject({ code: 'SPLAT_EDIT_UNATTACHED' });
  });

  it('refuse un blob absent du stockage', async () => {
    const missing = vi.fn().mockRejectedValue(new Error('404'));
    await expect(assertSplatEditBlobs(part(), { attachedKeys: [MASK], stat: missing })).rejects.toMatchObject(
      { statusCode: 400, code: 'SPLAT_EDIT_MISSING' },
    );
  });

  it('refuse un blob au-dessus du plafond, et accepte le plafond lui-même', async () => {
    await expect(
      assertSplatEditBlobs(part(), { attachedKeys: [MASK], stat: stat(MAX_SPLAT_EDIT_BLOB_BYTES + 1) }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'SPLAT_EDIT_TOO_LARGE' });
    await expect(
      assertSplatEditBlobs(part(), { attachedKeys: [MASK], stat: stat(MAX_SPLAT_EDIT_BLOB_BYTES) }),
    ).resolves.toBeUndefined();
  });
});

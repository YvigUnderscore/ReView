// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import {
  attachmentKeys,
  filterAttachments,
  orphanedKeys,
  ownAttachmentPrefix,
  shotgridAttachmentPrefix,
} from './commentAttachments';

describe('filterAttachments — la garde de préfixe', () => {
  const mine = ownAttachmentPrefix(7);
  const fromShotgrid = shotgridAttachmentPrefix(42);

  it('accepte le dossier de son auteur', () => {
    const kept = filterAttachments([{ key: `${mine}1-a.png` }], [mine]);
    expect(kept).toHaveLength(1);
  });

  it("refuse la clé d'un autre utilisateur", () => {
    expect(filterAttachments([{ key: 'comments/attachments/8/1-secret.png' }], [mine])).toEqual([]);
  });

  it('refuse une remontée de chemin même sous le bon préfixe', () => {
    expect(filterAttachments([{ key: `${mine}../8/1-secret.png` }], [mine])).toEqual([]);
  });

  it('conserve les pièces de la note ShotGrid du commentaire édité', () => {
    const kept = filterAttachments(
      [{ key: `${fromShotgrid}9-note.png` }, { key: `${mine}1-a.png` }],
      [mine, fromShotgrid],
    );
    expect(kept.map((a) => a.key)).toEqual([`${fromShotgrid}9-note.png`, `${mine}1-a.png`]);
  });

  it("refuse le dossier ShotGrid d'un autre commentaire", () => {
    const kept = filterAttachments(
      [{ key: `${shotgridAttachmentPrefix(43)}9-note.png` }],
      [mine, fromShotgrid],
    );
    expect(kept).toEqual([]);
  });

  it('tolère une liste absente', () => {
    expect(filterAttachments(undefined, [mine])).toEqual([]);
  });
});

describe('attachmentKeys / orphanedKeys', () => {
  it("ignore un blob JSON qui n'est pas une liste de descripteurs", () => {
    expect(attachmentKeys(null)).toEqual([]);
    expect(attachmentKeys('a.png')).toEqual([]);
    expect(attachmentKeys([{ name: 'a.png' }, 3, null])).toEqual([]);
  });

  it('relève les objets retirés de la liste', () => {
    const before = [{ key: 'a' }, { key: 'b' }, { key: 'c' }];
    expect(orphanedKeys(before, [{ key: 'b' }])).toEqual(['a', 'c']);
  });

  it('rend toutes les clés quand la liste devient vide', () => {
    expect(orphanedKeys([{ key: 'a' }], [])).toEqual(['a']);
    expect(orphanedKeys([{ key: 'a' }], null)).toEqual(['a']);
  });

  it("ne rend rien quand la liste n'a pas bougé", () => {
    expect(orphanedKeys([{ key: 'a' }], [{ key: 'a' }])).toEqual([]);
  });

  it('dédoublonne une clé répétée avant de la supprimer', () => {
    expect(orphanedKeys([{ key: 'a' }, { key: 'a' }], [])).toEqual(['a']);
  });
});

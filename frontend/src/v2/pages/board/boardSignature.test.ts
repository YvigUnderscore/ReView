// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { sceneSignature } from './boardSignature';
import type { BoardFiles } from './boardFiles';

const noFiles = {} as BoardFiles;
const el = (id: string, version: number, extra: Record<string, unknown> = {}) => ({
  id,
  version,
  versionNonce: 1,
  ...extra,
});

describe('sceneSignature', () => {
  it('rend la même empreinte pour deux objets distincts de même contenu', () => {
    // C'est tout l'enjeu : `onChange` reconstruit des objets neufs à chaque appel, et la
    // comparaison par identité faisait croire à un changement à chaque rendu.
    const a = sceneSignature([el('a', 3), el('b', 1)], noFiles);
    const b = sceneSignature([el('a', 3), el('b', 1)], noFiles);
    expect(a).toBe(b);
  });

  it('ignore les propriétés qui bougent sans que la scène change', () => {
    const avant = sceneSignature([el('a', 3, { x: 10, seed: 111 })], noFiles);
    const apres = sceneSignature([el('a', 3, { x: 10, seed: 222 })], noFiles);
    expect(apres).toBe(avant);
  });

  it('change quand un élément est réellement modifié', () => {
    const avant = sceneSignature([el('a', 3)], noFiles);
    expect(sceneSignature([el('a', 4)], noFiles)).not.toBe(avant);
  });

  it('change quand un élément est ajouté, retiré ou supprimé', () => {
    const base = sceneSignature([el('a', 3)], noFiles);
    expect(sceneSignature([el('a', 3), el('b', 1)], noFiles)).not.toBe(base);
    expect(sceneSignature([], noFiles)).not.toBe(base);
    expect(sceneSignature([el('a', 3, { isDeleted: true })], noFiles)).not.toBe(base);
  });

  it('suit les identifiants de fichiers, pas leur contenu ni leur ordre', () => {
    const f1 = { x: { id: 'x', dataURL: 'data:1' }, y: { id: 'y' } } as unknown as BoardFiles;
    const f2 = { y: { id: 'y' }, x: { id: 'x', dataURL: 'data:AUTRE' } } as unknown as BoardFiles;
    expect(sceneSignature([], f2)).toBe(sceneSignature([], f1));
    expect(sceneSignature([], { x: { id: 'x' } } as unknown as BoardFiles)).not.toBe(sceneSignature([], f1));
  });

  it('une scène vide a une empreinte stable', () => {
    expect(sceneSignature([], noFiles)).toBe(sceneSignature([], noFiles));
  });

  it('retombe sur le contenu quand un élément n’a pas la forme attendue', () => {
    expect(sceneSignature([{ sans: 'id' }], noFiles)).not.toBe(sceneSignature([{ autre: 'forme' }], noFiles));
  });
});

// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { itemOrderFor } from './usePlaylistUndo';

const item = (id: number, versionId: number) => ({ id, version: { id: versionId } });

describe('itemOrderFor', () => {
  it('remet les items dans l’ordre des versions d’avant, identifiant neuf compris', () => {
    // La version 20 a été retirée puis rajoutée : elle revient en fin de liste, item 99.
    const items = [item(1, 10), item(3, 30), item(99, 20)];
    expect(itemOrderFor(items, [10, 20, 30])).toEqual([1, 99, 3]);
  });

  it('saute une version qui n’est plus là (retirée en parallèle) au lieu d’échouer', () => {
    const items = [item(1, 10), item(99, 20)];
    expect(itemOrderFor(items, [10, 20, 30])).toEqual([1, 99]);
  });

  it('rend une liste vide quand rien de l’ordre d’avant ne subsiste', () => {
    expect(itemOrderFor([item(7, 70)], [10, 20])).toEqual([]);
  });
});

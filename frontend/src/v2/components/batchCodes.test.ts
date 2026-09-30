// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { MAX_BATCH_ITEMS, buildBatchItems } from './batchCodes';

const spec = { prefix: 'SH', start: 10, step: 10, padding: 3, count: 4 };

describe('buildBatchItems', () => {
  it('génère la série annoncée par les réglages', () => {
    expect(buildBatchItems(spec).map((i) => i.code)).toEqual(['SH010', 'SH020', 'SH030', 'SH040']);
  });

  it('reprend le code comme nom', () => {
    expect(buildBatchItems({ ...spec, count: 1 })[0]).toEqual({
      code: 'SH010',
      name: 'SH010',
      sequenceId: undefined,
    });
  });

  it('complète à la largeur demandée, et laisse déborder un nombre plus long', () => {
    expect(buildBatchItems({ ...spec, padding: 5, count: 1 })[0]?.code).toBe('SH00010');
    expect(buildBatchItems({ ...spec, start: 1234, padding: 2, count: 1 })[0]?.code).toBe('SH1234');
  });

  it('porte la destination sur chaque élément du lot', () => {
    const items = buildBatchItems({ ...spec, count: 3, sequenceId: 42 });
    expect(items.every((i) => i.sequenceId === 42)).toBe(true);
    expect(buildBatchItems({ ...spec, count: 1, sequenceId: null })[0]?.sequenceId).toBeNull();
  });

  it('borne le lot et ne rend rien pour un compte nul ou négatif', () => {
    expect(buildBatchItems({ ...spec, count: 5000 })).toHaveLength(MAX_BATCH_ITEMS);
    expect(buildBatchItems({ ...spec, count: 0 })).toEqual([]);
    expect(buildBatchItems({ ...spec, count: -3 })).toEqual([]);
  });

  it('accepte un pas nul sans boucler : la série se répète, elle ne s’allonge pas', () => {
    expect(buildBatchItems({ ...spec, step: 0, count: 2 }).map((i) => i.code)).toEqual(['SH010', 'SH010']);
  });
});

// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../lib/prisma', () => ({ prisma: {} }));
vi.mock('../../lib/logger', () => ({ logger: { info: vi.fn(), error: vi.fn() } }));
vi.mock('./ShotgridConfigService', () => ({ openConnection: vi.fn() }));

import { dedupeSteps, type PipelineStep } from './ShotgridSteps';

const step = (over: Partial<PipelineStep>): PipelineStep => ({
  sgId: 1,
  code: 'art',
  shortName: 'art',
  entityType: 'Asset',
  color: null,
  order: 0,
  used: false,
  ...over,
});

/**
 * ShotGrid masque les étapes dont la visibilité n'est pas activée dans le projet, mais ne
 * l'expose par aucun endpoint. À défaut, on écarte les homonymes — ce que ce réglage
 * masque en pratique sur un site qui accumule les étapes depuis des années.
 */
describe('dedupeSteps', () => {
  it('garde une seule étape par nom', () => {
    // ArtFX a deux « art » et deux « modeling » pour les assets.
    const r = dedupeSteps([
      step({ sgId: 13, code: 'art', shortName: 'art' }),
      step({ sgId: 999, code: 'art', shortName: 'ART2' }),
    ]);
    expect(r.map((s) => s.sgId)).toEqual([13]);
  });

  it('garde une seule étape par code court', () => {
    // « lookdev/ldv » et « Look Development/ldv » se lisent pareil dans une liste.
    const r = dedupeSteps([
      step({ sgId: 20, code: 'lookdev', shortName: 'ldv' }),
      step({ sgId: 21, code: 'Look Development', shortName: 'ldv' }),
    ]);
    expect(r.map((s) => s.sgId)).toEqual([20]);
  });

  it('ne confond pas deux étapes distinctes', () => {
    const r = dedupeSteps([
      step({ sgId: 13, code: 'art', shortName: 'art' }),
      step({ sgId: 14, code: 'modeling', shortName: 'mod' }),
      step({ sgId: 15, code: 'rigging', shortName: 'rig' }),
    ]);
    expect(r).toHaveLength(3);
  });

  it('ignore la casse et les espaces, comme le fait l’œil', () => {
    const r = dedupeSteps([
      step({ sgId: 14, code: 'modeling', shortName: 'mod' }),
      step({ sgId: 1584, code: ' Modeling ', shortName: 'MOD' }),
    ]);
    expect(r.map((s) => s.sgId)).toEqual([14]);
  });

  it('garde celle que le projet emploie : c’est elle qui porte le bon identifiant', () => {
    // Le cas qui rangeait la task ailleurs : l'étape « modeling » de ce projet porte
    // l'identifiant 14, le catalogue en offre une autre sous le 1584.
    const r = dedupeSteps([
      step({ sgId: 14, code: 'modeling', shortName: 'mod', used: true }),
      step({ sgId: 1584, code: 'modeling', shortName: 'modeling' }),
    ]);
    expect(r.map((s) => s.sgId)).toEqual([14]);
  });

  it('tolère une étape sans code court', () => {
    const r = dedupeSteps([
      step({ sgId: 30, code: 'groom', shortName: '' }),
      step({ sgId: 31, code: 'cloth', shortName: '' }),
    ]);
    expect(r).toHaveLength(2);
  });
});

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
 * ShotGrid hides the steps whose visibility is not enabled in the project, but exposes it through no endpoint. Failing that, we discard the homonyms — what this
 * setting masks in practice on a site that has accumulated steps for years.
 */
describe('dedupeSteps', () => {
  it('keeps a single step per name', () => {
    // ArtFX has two "art" and two "modeling" for assets.
    const r = dedupeSteps([
      step({ sgId: 13, code: 'art', shortName: 'art' }),
      step({ sgId: 999, code: 'art', shortName: 'ART2' }),
    ]);
    expect(r.map((s) => s.sgId)).toEqual([13]);
  });

  it('keeps a single step per short code', () => {
    // "lookdev/ldv" and "Look Development/ldv" read the same in a list.
    const r = dedupeSteps([
      step({ sgId: 20, code: 'lookdev', shortName: 'ldv' }),
      step({ sgId: 21, code: 'Look Development', shortName: 'ldv' }),
    ]);
    expect(r.map((s) => s.sgId)).toEqual([20]);
  });

  it('does not confuse two distinct steps', () => {
    const r = dedupeSteps([
      step({ sgId: 13, code: 'art', shortName: 'art' }),
      step({ sgId: 14, code: 'modeling', shortName: 'mod' }),
      step({ sgId: 15, code: 'rigging', shortName: 'rig' }),
    ]);
    expect(r).toHaveLength(3);
  });

  it('ignores case and spaces, as the eye does', () => {
    const r = dedupeSteps([
      step({ sgId: 14, code: 'modeling', shortName: 'mod' }),
      step({ sgId: 1584, code: ' Modeling ', shortName: 'MOD' }),
    ]);
    expect(r.map((s) => s.sgId)).toEqual([14]);
  });

  it('keeps the one the project uses: it is the one carrying the right identifier', () => {
    // The case that filed the task elsewhere: this project's "modeling" step carries identifier 14, the catalogue offers another under 1584.
    const r = dedupeSteps([
      step({ sgId: 14, code: 'modeling', shortName: 'mod', used: true }),
      step({ sgId: 1584, code: 'modeling', shortName: 'modeling' }),
    ]);
    expect(r.map((s) => s.sgId)).toEqual([14]);
  });

  it('keeps a step that only its short code distinguishes, if requested', () => {
    // The reported case: ArtFX has "modeling / modeling" and "modeling / model", and it is the second that this project uses. The choice catalogue must discard neither
    // of them — that is where they are told apart.
    const catalogue = [
      step({ sgId: 1584, code: 'modeling', shortName: 'modeling', order: 19 }),
      step({ sgId: 14, code: 'modeling', shortName: 'model', order: 43 }),
    ];
    expect(dedupeSteps(catalogue).map((s) => s.sgId)).toEqual([1584]);
    // ...but the raw list carries both of them.
    expect(catalogue.map((s) => s.sgId)).toEqual([1584, 14]);
  });

  it('tolerates a step without a short code', () => {
    const r = dedupeSteps([
      step({ sgId: 30, code: 'groom', shortName: '' }),
      step({ sgId: 31, code: 'cloth', shortName: '' }),
    ]);
    expect(r).toHaveLength(2);
  });
});

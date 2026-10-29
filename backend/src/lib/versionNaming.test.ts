// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { nextNumber, nextVersionName, versionNumber } from './versionNaming';

describe('versionNumber', () => {
  it('reads both conventions', () => {
    expect(versionNumber('V01')).toBe(1);
    expect(versionNumber('V002')).toBe(2);
    expect(versionNumber('DEMO_SH010_anim_v012')).toBe(12);
    expect(versionNumber('_model_v0001')).toBe(1);
  });

  it('falls back to the trailing digits when there is no "v"', () => {
    expect(versionNumber('SH010_anim_3')).toBe(3);
  });

  it('does not guess a number where there is none', () => {
    expect(versionNumber('final')).toBeNull();
    expect(versionNumber('')).toBeNull();
  });
});

describe('nextNumber', () => {
  it('starts at 1 under an empty parent', () => {
    expect(nextNumber([])).toBe(1);
  });

  it('never reuses a number already taken', () => {
    // The flaw this module fixes: counting versions ("there are 2, so the next is 3") regresses as
    // soon as one is deleted, and produces two V03 that do not designate the same work.
    expect(nextNumber(['V01', 'V02', 'V03'])).toBe(4);
    expect(nextNumber(['V01', 'V03'])).toBe(4); // V02 deleted
  });

  it('mixes conventions without getting the rank wrong', () => {
    // A project linked after the fact carries both forms under the same task.
    expect(nextNumber(['V01', 'DEMO_SH010_anim_v007'])).toBe(8);
  });

  it('ignores what carries no number', () => {
    expect(nextNumber(['final', 'V02'])).toBe(3);
    expect(nextNumber(['final'])).toBe(1);
  });
});

describe('nextVersionName', () => {
  it('keeps the short form outside a linked project', () => {
    expect(nextVersionName({ existing: [], linked: false, parentCode: 'SH010', step: 'anim' })).toBe('V01');
    expect(nextVersionName({ existing: ['V09'], linked: false })).toBe('V10');
  });

  it('follows the site convention on a linked project', () => {
    expect(nextVersionName({ existing: [], linked: true, parentCode: 'DEMO_SH010', step: 'anim' })).toBe(
      'DEMO_SH010_anim_v001',
    );
  });

  it('picks up the numbering where the site left it', () => {
    expect(
      nextVersionName({
        existing: ['DEMO_SH010_anim_v001', 'DEMO_SH010_anim_v002'],
        linked: true,
        parentCode: 'DEMO_SH010',
        step: 'anim',
      }),
    ).toBe('DEMO_SH010_anim_v003');
  });

  it('drops the step when the version hangs off no task', () => {
    expect(nextVersionName({ existing: [], linked: true, parentCode: 'Cathedral' })).toBe('Cathedral_v001');
  });

  it('falls back to the short form without an identifiable parent', () => {
    // "_anim_v001" would designate nothing: better a short but readable name.
    expect(nextVersionName({ existing: [], linked: true, step: 'anim' })).toBe('V01');
  });

  it('strips what cannot live in a code', () => {
    expect(
      nextVersionName({ existing: [], linked: true, parentCode: 'Cathédrale (nef)', step: 'look dev' }),
    ).toBe('Cathdrale_nef_look_dev_v001');
  });
});

describe('mimicking the site naming', () => {
  it('replays the shape of the most advanced sibling, prefix included', () => {
    // The project prefix ("DEMO_") cannot be guessed: it is taken from the sibling.
    expect(
      nextVersionName({
        existing: ['DEMO_SH010_anim_v007'],
        parentCode: 'SH010',
        step: null,
        linked: true,
      }),
    ).toBe('DEMO_SH010_anim_v008');
  });

  it('keeps the padding width and the case of the v', () => {
    expect(
      nextVersionName({ existing: ['SH010_comp_v0007'], parentCode: 'SH010', step: null, linked: true }),
    ).toBe('SH010_comp_v0008');
    expect(
      nextVersionName({ existing: ['SH010_comp_V07'], parentCode: 'SH010', step: null, linked: true }),
    ).toBe('SH010_comp_V08');
  });

  it("does not mimic a local V01, which is not a site code", () => {
    expect(nextVersionName({ existing: ['V01'], parentCode: 'SH010', step: 'anim', linked: true })).toBe(
      'SH010_anim_v002',
    );
  });

  it('changes nothing outside a linked project', () => {
    expect(
      nextVersionName({ existing: ['DEMO_SH010_anim_v007'], parentCode: 'SH010', step: null, linked: false }),
    ).toBe('V08');
  });
});

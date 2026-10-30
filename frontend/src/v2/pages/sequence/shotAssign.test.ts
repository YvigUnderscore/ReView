// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { attachRefusal, attachableShots, movedFromOtherSequence, type AttachableShot } from './shotAssign';

const shot = (id: number, code: string, sequenceId: number | null, name = code): AttachableShot => ({
  id,
  code,
  name,
  sequenceId,
});

/** An ordinary project: two shots in the open sequence, two elsewhere, two free. */
const PROJECT: AttachableShot[] = [
  shot(1, 'SH010', 7),
  shot(2, 'SH020', 7),
  shot(3, 'SH100', 8),
  shot(4, 'SH110', 8),
  shot(5, 'SH200', null),
  shot(6, 'SH210', null, 'Wide establishing'),
];

describe('attachableShots', () => {
  it('excludes the shots already in the sequence', () => {
    const { free, elsewhere } = attachableShots(PROJECT, 7);
    const proposed = [...free, ...elsewhere].map((s) => s.id);
    expect(proposed).not.toContain(1);
    expect(proposed).not.toContain(2);
    expect(proposed).toHaveLength(4);
  });

  it('separates free shots from those taken from another sequence', () => {
    const { free, elsewhere } = attachableShots(PROJECT, 7);
    expect(free.map((s) => s.code)).toEqual(['SH200', 'SH210']);
    expect(elsewhere.map((s) => s.code)).toEqual(['SH100', 'SH110']);
  });

  it('sorts codes numerically, not alphabetically', () => {
    const messy = [shot(1, 'SH100', null), shot(2, 'SH20', null), shot(3, 'SH3', null)];
    expect(attachableShots(messy, 7).free.map((s) => s.code)).toEqual(['SH3', 'SH20', 'SH100']);
  });

  it('filters on code and name, ignoring case', () => {
    expect(attachableShots(PROJECT, 7, 'sh1').elsewhere.map((s) => s.id)).toEqual([3, 4]);
    expect(attachableShots(PROJECT, 7, 'ESTABLISHING').free.map((s) => s.id)).toEqual([6]);
    expect(attachableShots(PROJECT, 7, '  sh210  ').free.map((s) => s.id)).toEqual([6]);
  });

  it('proposes nothing when the whole project is already in the sequence', () => {
    const all = [shot(1, 'SH010', 7), shot(2, 'SH020', 7)];
    expect(attachableShots(all, 7)).toEqual({ free: [], elsewhere: [] });
  });
});

describe('movedFromOtherSequence', () => {
  it('only counts the selected shots that leave a sequence', () => {
    expect(movedFromOtherSequence(PROJECT, new Set([3, 5, 6]))).toBe(1);
  });

  it('is zero when the selection only contains free shots', () => {
    expect(movedFromOtherSequence(PROJECT, new Set([5, 6]))).toBe(0);
  });

  it('ignores identifiers that are not in the list', () => {
    expect(movedFromOtherSequence(PROJECT, new Set([999]))).toBe(0);
  });
});

describe('attachRefusal', () => {
  it('refuses a non-manager, whether the selection is filled or not', () => {
    expect(attachRefusal(false, 3)).toBe('forbidden');
    expect(attachRefusal(false, 0)).toBe('forbidden');
  });

  it('refuses an empty selection', () => {
    expect(attachRefusal(true, 0)).toBe('empty');
  });

  it('lets through a manager who has made a choice', () => {
    expect(attachRefusal(true, 1)).toBeNull();
  });
});

// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { readViewState, sameViewState, type ReviewViewState } from './viewState';
import { DEFAULT_LIGHTING } from '../reviewTypes';

const full: ReviewViewState = {
  display: 'wireframe',
  section: { active: true, axis: 'z', position: 1.25, flip: true },
  lighting: { ...DEFAULT_LIGHTING, hdriId: 'studio', exposure: 1.4, rotationDeg: 90 },
};

describe('viewState.readViewState', () => {
  it('reads the view state attached to a camera view', () => {
    expect(readViewState({ position: { x: 0, y: 0, z: 5 }, view: full })).toEqual(full);
  });

  it('returns null for views that carry none (earlier comments)', () => {
    expect(readViewState(null)).toBeNull();
    expect(readViewState({ position: { x: 0, y: 0, z: 5 } })).toBeNull();
    expect(readViewState('nope')).toBeNull();
  });

  it('falls back to safe values in front of an incomplete or hostile blob', () => {
    const state = readViewState({ view: { display: 'hologramme', section: { axis: 'w' } } });
    expect(state?.display).toBe('shaded');
    expect(state?.section).toEqual({ active: false, axis: 'x', position: 0, flip: false });
    expect(state?.lighting).toEqual({ ...DEFAULT_LIGHTING, hdriId: undefined });
  });

  it('ignores a non-finite section position', () => {
    expect(readViewState({ view: { section: { position: 'loin' } } })?.section.position).toBe(0);
  });
});

describe('viewState.sameViewState', () => {
  it('compares field by field, without depending on key order', () => {
    const other = readViewState({ view: JSON.parse(JSON.stringify(full)) as unknown });
    expect(sameViewState(full, other)).toBe(true);
    expect(sameViewState(null, null)).toBe(true);
    expect(sameViewState(full, null)).toBe(false);
  });

  it('detects the slightest difference (otherwise the live session would reapply everything in a loop)', () => {
    expect(sameViewState(full, { ...full, display: 'uv' })).toBe(false);
    expect(sameViewState(full, { ...full, section: { ...full.section, position: 1.26 } })).toBe(false);
    expect(sameViewState(full, { ...full, lighting: { ...full.lighting, hdriId: 'autre' } })).toBe(false);
  });
});

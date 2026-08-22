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
  it('relit l’état de vue joint à une vue caméra', () => {
    expect(readViewState({ position: { x: 0, y: 0, z: 5 }, view: full })).toEqual(full);
  });

  it('renvoie null pour les vues qui n’en portent pas (commentaires antérieurs)', () => {
    expect(readViewState(null)).toBeNull();
    expect(readViewState({ position: { x: 0, y: 0, z: 5 } })).toBeNull();
    expect(readViewState('nope')).toBeNull();
  });

  it('retombe sur des valeurs sûres devant un blob incomplet ou hostile', () => {
    const state = readViewState({ view: { display: 'hologramme', section: { axis: 'w' } } });
    expect(state?.display).toBe('shaded');
    expect(state?.section).toEqual({ active: false, axis: 'x', position: 0, flip: false });
    expect(state?.lighting).toEqual({ ...DEFAULT_LIGHTING, hdriId: undefined });
  });

  it('ignore une position de coupe non finie', () => {
    expect(readViewState({ view: { section: { position: 'loin' } } })?.section.position).toBe(0);
  });
});

describe('viewState.sameViewState', () => {
  it('compare champ par champ, sans dépendre de l’ordre des clés', () => {
    const other = readViewState({ view: JSON.parse(JSON.stringify(full)) as unknown });
    expect(sameViewState(full, other)).toBe(true);
    expect(sameViewState(null, null)).toBe(true);
    expect(sameViewState(full, null)).toBe(false);
  });

  it('détecte le moindre écart (sinon la session live réappliquerait tout en boucle)', () => {
    expect(sameViewState(full, { ...full, display: 'uv' })).toBe(false);
    expect(sameViewState(full, { ...full, section: { ...full.section, position: 1.26 } })).toBe(false);
    expect(sameViewState(full, { ...full, lighting: { ...full.lighting, hdriId: 'autre' } })).toBe(false);
  });
});

// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_LIGHTING } from '../reviewTypes';
import type { Model3DInspectState } from './useModel3DInspect';
import type { Model3DLightingState } from './useModel3DLighting';
import type { Model3DThreeState } from './useModel3DThree';
import type { SectionPlaneState } from './useSectionPlane';
import type { ViewStateProvider } from './useModelCameraHandles';
import { useModel3DViewState } from './useModel3DViewState';

afterEach(cleanup);

const LIGHTING = { ...DEFAULT_LIGHTING, hdriId: 'studio', exposure: 1.4 };

function harness(mode = 'wireframe') {
  const registerViewState = vi.fn();
  const model3d = { registerViewState } as unknown as Model3DThreeState;
  const inspect = { mode, setMode: vi.fn() } as unknown as Model3DInspectState;
  const section = {
    active: true,
    axis: 'z',
    position: 2.5,
    flip: true,
    apply: vi.fn(),
  } as unknown as SectionPlaneState;
  const lighting = { cfg: LIGHTING, setCfg: vi.fn() } as unknown as Model3DLightingState;
  const view = renderHook((p: { mode: string } = { mode }) =>
    useModel3DViewState({
      model3d,
      inspect: { ...inspect, mode: p.mode } as unknown as Model3DInspectState,
      section,
      lighting,
    }),
  );
  const provider = registerViewState.mock.calls[0][0] as ViewStateProvider;
  return { view, provider, registerViewState, inspect, section, lighting };
}

describe('useModel3DViewState', () => {
  it('capture le mode d’affichage, le plan de coupe et l’éclairage', () => {
    const { provider } = harness();
    expect(provider.capture()).toEqual({
      display: 'wireframe',
      section: { active: true, axis: 'z', position: 2.5, flip: true },
      lighting: LIGHTING,
    });
  });

  it('rejoue l’état d’un commentaire sur les trois hooks', () => {
    const { provider, inspect, section, lighting } = harness();
    const next = {
      display: 'uv' as const,
      section: { active: false, axis: 'x' as const, position: 0, flip: false },
      lighting: DEFAULT_LIGHTING,
    };
    provider.apply(next);
    expect(inspect.setMode).toHaveBeenCalledWith('uv');
    expect(section.apply).toHaveBeenCalledWith(next.section);
    expect(lighting.setCfg).toHaveBeenCalledWith(DEFAULT_LIGHTING);
  });

  it('capture l’état courant après un nouveau rendu, sans se réenregistrer', () => {
    const { view, provider, registerViewState } = harness('shaded');
    view.rerender({ mode: 'matcap' });
    expect(provider.capture().display).toBe('matcap');
    expect(registerViewState).toHaveBeenCalledTimes(1);
  });

  it('se retire au démontage (aucun état de vue joint sans viewer 3D)', () => {
    const { view, registerViewState } = harness();
    view.unmount();
    expect(registerViewState).toHaveBeenLastCalledWith(null);
  });
});

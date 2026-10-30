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
  it('captures the display mode, the section plane and the lighting', () => {
    const { provider } = harness();
    expect(provider.capture()).toEqual({
      display: 'wireframe',
      section: { active: true, axis: 'z', position: 2.5, flip: true },
      lighting: LIGHTING,
    });
  });

  it('replays a comment state on the three hooks', () => {
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

  it('captures the current state after a new render, without re-registering', () => {
    const { view, provider, registerViewState } = harness('shaded');
    view.rerender({ mode: 'matcap' });
    expect(provider.capture().display).toBe('matcap');
    expect(registerViewState).toHaveBeenCalledTimes(1);
  });

  it('unregisters on unmount (no view state attached without a 3D viewer)', () => {
    const { view, registerViewState } = harness();
    view.unmount();
    expect(registerViewState).toHaveBeenLastCalledWith(null);
  });
});

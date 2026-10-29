// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import Model3DRenderMenu from './Model3DRenderMenu';
import { panelsFor } from '../chrome/panels';
import { DISPLAY_MODES } from './displayModes';
import type { Model3DInspectState } from './useModel3DInspect';
import type { Model3DVariantsState } from './useModel3DVariants';
import { t } from '@/v2/i18n';

/**
 * The "Display" tab of the 3D dock has disappeared: its settings live in a popover in the top-left
 * corner of the viewer. What is checked here is exactly what removing the tab must preserve: the full
 * list of settings that have an effect, and the fact that the render mode comes back to the same state
 * (`useModel3DInspect`) as the one that applies the override to the scene, without a second path
 * opening up.
 */

const inspectState = (over: Partial<Model3DInspectState> = {}): Model3DInspectState => ({
  mode: 'shaded',
  setMode: vi.fn(),
  stats: null,
  extensions: [],
  hasSkeleton: false,
  showSkeleton: false,
  setShowSkeleton: vi.fn(),
  ...over,
});

const variantsState = (over: Partial<Model3DVariantsState> = {}): Model3DVariantsState => ({
  variants: [],
  cameras: [],
  current: -1,
  selectVariant: vi.fn(),
  goToCamera: vi.fn(),
  ...over,
});

/** Opens the popover and makes its content reachable. */
function open(inspect: Model3DInspectState, variants = variantsState()) {
  render(<Model3DRenderMenu inspect={inspect} variants={variants} />);
  fireEvent.click(screen.getByRole('button', { name: t('viewer.render.title') }));
}

describe('dock 3D', () => {
  it('no longer has a "Display" tab: the splat followed in lot 12', () => {
    // This test used to assert "the splat keeps its own"; it is rewritten, not disabled: the splat
    // took the same path, its render settings now living on its own viewer
    // (`splat/SplatViewerMenus`). No dock carries this tab any more.
    for (const kind of ['MODEL_3D', 'SPLAT'] as const)
      expect(panelsFor(kind).map((p) => p.id)).not.toContain('display');
  });
});

describe('Model3DRenderMenu', () => {
  it('carries the five render modes, and no fewer', () => {
    open(inspectState());
    const group = screen.getByRole('group', { name: t('viewer.render.model') });
    expect(group.querySelectorAll('button')).toHaveLength(DISPLAY_MODES.length);
    for (const mode of ['shaded', 'wireframe', 'normals', 'matcap', 'uv'] as const)
      expect(screen.getByRole('button', { name: t(`viewer.mode.${mode}`) })).toBeInTheDocument();
  });

  it('changes the render mode through the review component path', () => {
    const setMode = vi.fn();
    open(inspectState({ setMode }));
    fireEvent.click(screen.getByRole('button', { name: t('viewer.mode.wireframe') }));
    expect(setMode).toHaveBeenCalledWith('wireframe');
  });

  it('shows the current mode as active', () => {
    open(inspectState({ mode: 'matcap' }));
    expect(screen.getByRole('button', { name: t('viewer.mode.matcap') })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('offers material variants and embedded cameras when the file carries them', () => {
    const selectVariant = vi.fn();
    open(
      inspectState(),
      variantsState({
        variants: ['Wood', 'Metal'],
        current: 0,
        selectVariant,
        cameras: [{ name: 'shotCam' }] as Model3DVariantsState['cameras'],
      }),
    );
    // Two lists: material variants first, embedded cameras afterwards: the order of the panel,
    // the very one the removed tab used to serve.
    const selects = screen.getAllByRole('combobox');
    expect(selects).toHaveLength(2);
    expect(screen.getByText('Wood')).toBeInTheDocument();
    expect(screen.getByText('shotCam')).toBeInTheDocument();
    fireEvent.change(selects[0], { target: { value: 'Metal' } });
    expect(selectVariant).toHaveBeenCalledWith(1);
  });

  it('offers the rig skeleton only when the model has one', () => {
    const setShowSkeleton = vi.fn();
    open(inspectState({ hasSkeleton: true, setShowSkeleton }));
    fireEvent.click(screen.getByRole('switch', { name: t('viewer.skeleton.hint') }));
    expect(setShowSkeleton).toHaveBeenCalledWith(true);
  });

  it('shows neither variant nor skeleton on a file that has none', () => {
    open(inspectState());
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });
});

// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  canCleanModel3d,
  model3dCleanTools,
  model3dSwitcherModes,
  model3dToolsFor,
  type Model3DCleanReach,
} from './model3dChrome';
import { canSwitchMode, switcherModesFor } from '../chrome/modes';
import { chromeCommandFor } from '../chrome/shortcuts';

/**
 * Switcher of the 3D model viewer after batch 6: "Staging" left the segments (its toggle now lives
 * in the Camera panel) and "Clean" only shows when it is useful.
 *
 * This file also checks the two ways a dead button can sneak back in through the service door:
 * the tool key that arms a mode missing from the switcher, and the splat, whose switcher shares
 * the same `modes.ts` and must not move by a single segment.
 */

const values = (reach: Model3DCleanReach) => model3dSwitcherModes(canCleanModel3d(reach)).map((m) => m.value);

/** The bare case: a GLB without a USD scene, whose only write is the transform. */
const plainGlb = (canEditTransform: boolean): Model3DCleanReach => ({
  canEditTransform,
  hasScenegraph: false,
});

describe('model3dSwitcherModes', () => {
  it('no longer offers "Staging" as a segment', () => {
    for (const can of [true, false]) expect(values(plainGlb(can))).not.toContain('stage');
  });

  it('only offers "Clean" when it is usable', () => {
    expect(values(plainGlb(true))).toEqual(['explore', 'clean']);
    expect(values(plainGlb(false))).toEqual(['explore']);
  });

  it('hides the switcher when only Explore is left', () => {
    // A single segment switches to nothing: the chrome rule, applied as is.
    expect(canSwitchMode('ARTIST', values(plainGlb(false)).length)).toBe(false);
    expect(canSwitchMode('ARTIST', values(plainGlb(true)).length)).toBe(true);
  });

  it('no longer promises "Clean" tools the model does not have', () => {
    // The spatial chrome tooltip announces "selection, deletion, cut volumes,
    // transform": three of these four gestures are point-cloud tools, specific to the splat.
    const clean = model3dSwitcherModes(true).find((mode) => mode.value === 'clean');
    expect(clean?.hintKey).not.toBe('mode.clean.hint');
    expect(switcherModesFor('SPLAT').find((m) => m.value === 'clean')?.hintKey).toBe('mode.clean.hint');
  });

  it('leaves the splat switcher intact — same modes file, other viewer', () => {
    const splat = switcherModesFor('SPLAT').map((m) => m.value);
    expect(splat).toContain('stage');
    expect(splat).toContain('clean');
  });
});

describe('canCleanModel3d', () => {
  it('requires both: tools AND a place to keep the result', () => {
    // The TRS gizmos are there (the selection tools, however, are specific to the splat):
    // so it is the destination of their work that decides.
    expect(model3dCleanTools().length).toBeGreaterThan(0);
    expect(canCleanModel3d({ canEditTransform: true, hasScenegraph: false })).toBe(true);
    expect(canCleanModel3d({ canEditTransform: false, hasScenegraph: false })).toBe(false);
  });

  it('stays offered on a USD scene without the right to write the transform', () => {
    // The same gizmos target a prim and write into the scene override (46.N): a delta replayed
    // for everyone when a manager saves it, reachable by a comment from any reviewer. Judging it on
    // `editTransform` alone would remove this feature by removing the tab.
    expect(canCleanModel3d({ canEditTransform: false, hasScenegraph: true })).toBe(true);
    expect(values({ canEditTransform: false, hasScenegraph: true })).toContain('clean');
  });

  it('offers no point-cloud tool on a model', () => {
    const ids = model3dCleanTools().map((tool) => tool.id);
    for (const splatOnly of ['sel-rect', 'sel-lasso', 'sel-brush', 'volume'])
      expect(ids).not.toContain(splatOnly);
  });
});

describe('model3dToolsFor', () => {
  it('empties the "Clean" mode rail when it is unavailable', () => {
    expect(model3dToolsFor('clean', false)).toEqual([]);
    expect(model3dToolsFor('clean', true).map((tool) => tool.id)).toContain('translate');
  });

  it('does not touch the other modes', () => {
    for (const mode of ['explore', 'annotate', 'stage'] as const)
      expect(model3dToolsFor(mode, false)).toEqual(model3dToolsFor(mode, true));
  });
});

describe('shortcuts — a removed mode is not armed from the keyboard', () => {
  const press = (key: string, canClean: boolean) =>
    chromeCommandFor(key, {
      kind: 'MODEL_3D',
      mode: 'explore',
      tool: 'nav',
      modes: model3dSwitcherModes(canClean),
      toolsOf: (mode) => model3dToolsFor(mode, canClean),
    });

  it('does not send "T" into an unavailable "Clean" mode', () => {
    // Without the right to save, `T` must not arm the translation gizmo: it would
    // find the staging camera tool, which saves nothing locked.
    const command = press('t', false);
    expect(command).toEqual({ action: 'tool', mode: 'stage', tool: 'cam-move' });
  });

  it('sends "T" there as soon as the mode is offered', () => {
    expect(press('t', true)).toEqual({ action: 'tool', mode: 'clean', tool: 'translate' });
  });

  it('keeps only the "1" key as mode toggle when a single segment remains', () => {
    expect(press('1', false)).toEqual({ action: 'mode', mode: 'explore' });
    expect(press('2', false)).toBeNull();
    expect(press('2', true)).toEqual({ action: 'mode', mode: 'clean' });
  });
});

// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  chromePrefsKey,
  defaultChromeState,
  drawerForKind,
  readChromePrefs,
  reconcileChrome,
  type ChromeState,
} from './chromeState';
import { allowedModesFor, modesFor, switcherModesFor } from './modes';
import { panelsFor } from './panels';
import { toolSearchOrder, toolsFor, viewActionsFor } from './tools';

describe('modes', () => {
  it('opens each media type on explore', () => {
    for (const kind of ['VIDEO', 'IMAGE', 'MODEL_3D', 'SPLAT'] as const) {
      expect(modesFor(kind)[0].value).toBe('explore');
    }
  });

  it('gives a fourth mode to spatial media only', () => {
    // The two flat media are at three: the image lost "Fit" (D1, an eyedropper
    // and a zoom for a helper that promised exposure, gamma and channels), the video lost
    // "Cut" (Phase 50). This test asserted "four modes for video": it is
    // rewritten for the new state, which is the choice we mean to keep.
    expect(modesFor('MODEL_3D')).toHaveLength(4);
    expect(modesFor('SPLAT')).toHaveLength(4);
    expect(modesFor('VIDEO')).toHaveLength(3);
    expect(modesFor('IMAGE')).toHaveLength(3);
    expect(modesFor('VIDEO').map((m) => m.value)).toEqual(modesFor('IMAGE').map((m) => m.value));
  });

  it('gives the same modes to the 3D model and the splat', () => {
    expect(modesFor('MODEL_3D').map((m) => m.value)).toEqual(modesFor('SPLAT').map((m) => m.value));
  });

  it('the toggle does not list Annotate, which remains a valid mode', () => {
    for (const kind of ['VIDEO', 'IMAGE', 'MODEL_3D', 'SPLAT'] as const) {
      expect(switcherModesFor(kind).map((m) => m.value)).not.toContain('annotate');
      expect(switcherModesFor(kind)).toHaveLength(kind === 'IMAGE' || kind === 'VIDEO' ? 2 : 3);
      // `reconcileChrome` validates against the full list: annotation is armed elsewhere.
      expect(modesFor(kind).map((m) => m.value)).toContain('annotate');
    }
  });

  it('removes Compare when no neighbouring version exists — the mode was arming on nothing', () => {
    // The comparison selector disappeared at the same time: one entered a mode that
    // showed no comparison, with no way out other than leaving it.
    for (const kind of ['VIDEO', 'IMAGE'] as const) {
      expect(switcherModesFor(kind, true).map((m) => m.value)).toContain('compare');
      expect(switcherModesFor(kind, false).map((m) => m.value)).not.toContain('compare');
      expect(allowedModesFor(kind, false).map((m) => m.value)).not.toContain('compare');
      // The rest of the chrome does not move: only "Compare" depends on the neighbours.
      expect(allowedModesFor(kind, false).map((m) => m.value)).toContain('annotate');
    }
  });
});

describe('toolSearchOrder — a tool shortcut switches to the mode that carries it', () => {
  it('starts with the current mode, without duplicates, and covers all modes', () => {
    const order = toolSearchOrder('VIDEO', 'compare');
    expect(order[0]).toBe('compare');
    expect(new Set(order).size).toBe(order.length);
    expect([...order].sort()).toEqual(
      modesFor('VIDEO')
        .map((m) => m.value)
        .sort(),
    );
  });

  it('in spatial, Clean up answers before Staging: T/R/S arm the gizmos', () => {
    const order = toolSearchOrder('MODEL_3D', 'explore');
    expect(order[0]).toBe('explore');
    expect(order.indexOf('clean')).toBeLessThan(order.indexOf('stage'));
    const t = toolsFor(
      order.find((m) => toolsFor(m, 'MODEL_3D').some((x) => x.key === 'T'))!,
      'MODEL_3D',
    );
    expect(t.find((x) => x.key === 'T')!.id).toBe('translate');
  });

  it('the current mode keeps control of its own keys (Staging camera)', () => {
    const order = toolSearchOrder('MODEL_3D', 'stage');
    const first = order.find((m) => toolsFor(m, 'MODEL_3D').some((x) => x.key === 'T'))!;
    expect(toolsFor(first, 'MODEL_3D').find((x) => x.key === 'T')!.id).toBe('cam-move');
  });

  it('a drawing tool stays reachable from the keyboard: D switches to Annotate (video)', () => {
    const order = toolSearchOrder('VIDEO', 'explore');
    const mode = order.find((m) => toolsFor(m, 'VIDEO').some((x) => x.key === 'D'))!;
    expect(mode).toBe('annotate');
  });
});

describe('tools', () => {
  it('always starts with nav', () => {
    for (const kind of ['VIDEO', 'IMAGE', 'MODEL_3D', 'SPLAT'] as const)
      for (const mode of modesFor(kind)) expect(toolsFor(mode.value, kind)[0].id).toBe('nav');
  });

  it('reserves the selection tools and the volume for the splat', () => {
    expect(toolsFor('clean', 'SPLAT').map((t) => t.id)).toContain('sel-lasso');
    expect(toolsFor('clean', 'MODEL_3D').map((t) => t.id)).not.toContain('sel-lasso');
    // The gizmos, however, serve both.
    expect(toolsFor('clean', 'MODEL_3D').map((t) => t.id)).toEqual(['nav', 'translate', 'rotate', 'scale']);
  });

  it('never assigns the same shortcut twice within a mode', () => {
    for (const kind of ['VIDEO', 'IMAGE', 'MODEL_3D', 'SPLAT'] as const)
      for (const mode of modesFor(kind)) {
        const keys = toolsFor(mode.value, kind).map((t) => t.key);
        expect(new Set(keys).size).toBe(keys.length);
      }
  });

  it('offers Fit and Original view in 3D, Fit and 1:1 for flat media', () => {
    expect(viewActionsFor('SPLAT').map((a) => a.key)).toEqual(['F', 'H']);
    expect(viewActionsFor('VIDEO').map((a) => a.labelKey)).toEqual(['action.fitMedia', 'action.resetMedia']);
  });
});

describe('panels', () => {
  it('exposes lighting only on the 3D model', () => {
    expect(panelsFor('MODEL_3D').map((p) => p.id)).toContain('light');
    expect(panelsFor('SPLAT').map((p) => p.id)).not.toContain('light');
  });

  it('the flat dock only has Info and Export, video and image alike', () => {
    // This test asserted five tabs on the video side and three on the image side; it is rewritten on the
    // Phase 50 decision, taken by the user with full knowledge of the consequence. Each of the
    // five departed tabs repeated the player or set at the dock what is set on the image:
    // "Comparison" (B lives in the options bar), "Display" (a frame rate on a still
    // image), "Playback" (the frame rate, already in the spec sheet), "Guides" (the
    // four switches are on the viewer's right-click) and "Image" — the Color panel, whose
    // display/view stays the project's and keeps applying to the viewer.
    for (const kind of ['VIDEO', 'IMAGE'] as const)
      expect(panelsFor(kind).map((p) => p.id)).toEqual(['info', 'export']);
  });

  it('no longer offers any of the removed tabs in the flat dock', () => {
    for (const kind of ['VIDEO', 'IMAGE'] as const) {
      const ids = panelsFor(kind).map((p) => String(p.id));
      for (const gone of ['compare', 'view', 'playback', 'image', 'guides']) expect(ids).not.toContain(gone);
    }
  });

  it('removes "Display" from BOTH spatial docks', () => {
    // This test was rewritten twice, each time for the same ongoing decision: batch 6
    // removed the "Display" tab from the 3D dock, batch 12 did the same for the splat. It set, at
    // the other end of the screen, behind a fold, toggles one tries in bursts while
    // watching the media. Its settings did not disappear: they moved to a popover in the
    // viewer's top-left corner (`Model3DRenderMenu`, `SplatViewerMenus`), with the same
    // `DisplayPanel` inside. Lighting remains the only difference between the two docks.
    expect(panelsFor('SPLAT').map((p) => p.id)).toEqual(['camera', 'scene', 'info', 'export']);
    expect(panelsFor('MODEL_3D').map((p) => p.id)).toEqual(['camera', 'light', 'scene', 'info', 'export']);
  });
});

describe('reconcileChrome', () => {
  const state = (patch: Partial<ChromeState>): ChromeState => ({
    ...defaultChromeState(),
    panel: 'camera',
    ...patch,
  });

  it('leaves a consistent state intact (same reference)', () => {
    const s = state({});
    expect(reconcileChrome(s, 'SPLAT')).toBe(s);
  });

  it('folds the tool back to nav when it does not exist in the mode', () => {
    const s = state({ mode: 'explore', tool: 'sel-lasso' });
    expect(reconcileChrome(s, 'SPLAT').tool).toBe('nav');
  });

  it('keeps the tool when the mode contains it', () => {
    const s = state({ mode: 'clean', tool: 'sel-lasso' });
    expect(reconcileChrome(s, 'SPLAT').tool).toBe('sel-lasso');
  });

  it('drops a spatial mode back to explore when switching to a flat media', () => {
    const s = state({ mode: 'clean', tool: 'sel-rect' });
    const next = reconcileChrome(s, 'VIDEO');
    expect(next.mode).toBe('explore');
    expect(next.tool).toBe('nav');
  });

  it('drops Compare back to exploration when no neighbouring version exists', () => {
    const s = state({ mode: 'compare', panel: null });
    expect(reconcileChrome(s, 'IMAGE', true).mode).toBe('compare');
    expect(reconcileChrome(s, 'IMAGE', false).mode).toBe('explore');
    // The tool follows: the stroke only exists in annotation mode. (Comparison itself
    // has had no tool of its own since the "Wipe bar" left the rail — the mode already arms
    // the wipe.)
    expect(reconcileChrome(state({ mode: 'compare', tool: 'draw', panel: null }), 'IMAGE', false).tool).toBe(
      'nav',
    );
  });

  it('replaces a panel missing from the dock with the first one, but respects a folded dock', () => {
    expect(reconcileChrome(state({ panel: 'light' }), 'SPLAT').panel).toBe('camera');
    expect(reconcileChrome(state({ panel: null }), 'SPLAT').panel).toBeNull();
  });

  it('drops a panel removed from the flat dock back to Info (Phase 50)', () => {
    // A state carried over from a spatial media or a removed tab must not leave the dock
    // open on nothing: the media's first panel takes its place.
    for (const kind of ['VIDEO', 'IMAGE'] as const) {
      expect(reconcileChrome(state({ panel: 'camera' }), kind).panel).toBe('info');
      expect(reconcileChrome(state({ panel: 'export' }), kind).panel).toBe('export');
    }
  });

  it('closes the drawer that does not belong to the media family', () => {
    expect(reconcileChrome(state({ drawer: 'curves' }), 'SPLAT').drawer).toBe('curves');
    expect(reconcileChrome(state({ drawer: 'curves' }), 'VIDEO').drawer).toBeNull();
    expect(reconcileChrome(state({ drawer: 'strip' }), 'VIDEO').drawer).toBe('strip');
  });
});

describe('preferences', () => {
  it('names the key per media type', () => {
    expect(chromePrefsKey('SPLAT')).toBe('review.chrome.SPLAT');
    expect(chromePrefsKey('VIDEO')).not.toBe(chromePrefsKey('IMAGE'));
  });

  it('chooses the drawer of the family', () => {
    expect(drawerForKind('MODEL_3D')).toBe('curves');
    expect(drawerForKind('IMAGE')).toBe('strip');
  });

  it('reads back valid preferences', () => {
    const raw = JSON.stringify({
      panel: 'scene',
      labels: true,
      comments: false,
      drawerOpen: true,
      drawerH: 240,
    });
    expect(readChromePrefs('SPLAT', raw)).toEqual({
      panel: 'scene',
      labels: true,
      comments: false,
      drawerOpen: true,
      drawerH: 240,
    });
  });

  it('falls back to the defaults if the value is missing, corrupt or foreign to the media', () => {
    // Default: dock folded — the media comes before the settings as long as nothing was chosen.
    const fallback = { panel: null, labels: false, comments: true, drawerOpen: false, drawerH: 168 };
    expect(readChromePrefs('SPLAT', null)).toEqual(fallback);
    expect(readChromePrefs('SPLAT', '{oops')).toEqual(fallback);
    // `light` does not exist in a splat's dock.
    expect(readChromePrefs('SPLAT', JSON.stringify({ panel: 'light' })).panel).toBeNull();
    // Preference inherited from a removed panel (`view`, `compare`, `guides`, and since
    // Phase 50 `playback` and `image`): the dock folds instead of opening a tab that
    // no longer exists. That is the dock's default, and it is fairer than forcing Info on whoever
    // never asked for Info — `reconcileChrome`, on the other hand, keeps an already open dock and takes
    // the first panel.
    for (const panel of ['view', 'compare', 'guides', 'playback', 'image'])
      for (const kind of ['VIDEO', 'IMAGE'] as const)
        expect(readChromePrefs(kind, JSON.stringify({ panel })).panel).toBeNull();
    // The two tabs that remain are read back as they are.
    for (const panel of ['info', 'export'])
      expect(readChromePrefs('VIDEO', JSON.stringify({ panel })).panel).toBe(panel);
  });

  it('clamps the drawer height and ignores an invalid value', () => {
    expect(readChromePrefs('SPLAT', JSON.stringify({ drawerH: 9999 })).drawerH).toBe(480);
    expect(readChromePrefs('SPLAT', JSON.stringify({ drawerH: 10 })).drawerH).toBe(120);
    expect(readChromePrefs('SPLAT', JSON.stringify({ drawerH: 'big' })).drawerH).toBe(168);
  });

  it('keeps an explicitly folded dock', () => {
    expect(readChromePrefs('VIDEO', JSON.stringify({ panel: null })).panel).toBeNull();
  });
});

/**
 * The publication lock no longer touches ANY mode: `edit` — the video cut — was the last one, and
 * it disappeared with the feature (Phase 50, batch 4). `isLockedByPublication` and the table it
 * read were therefore removed rather than left to answer "no" to every question. What remains
 * locked server-side (version transform, re-finalization) is not a chrome mode: its test lives in
 * `lib/publishLock.test.ts`.
 */
describe('modes and publication', () => {
  it('no longer offers any mode that publication would close', () => {
    for (const kind of ['VIDEO', 'IMAGE', 'MODEL_3D', 'SPLAT'] as const) {
      expect(modesFor(kind).map((m) => String(m.value))).not.toContain('edit');
    }
  });
});

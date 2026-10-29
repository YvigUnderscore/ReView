// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import type { MediaKind, Role } from '@/v2/types/api';
import { DEFAULT_MODE, allowedModesFor, canSwitchMode, modesFor, switcherModesFor } from './modes';

const KINDS: MediaKind[] = ['VIDEO', 'IMAGE', 'MODEL_3D', 'SPLAT'];
const INTERNAL: Role[] = ['ADMIN', 'SUPERVISOR', 'ARTIST'];

describe('canSwitchMode', () => {
  it('refuses the toggle to the client, for all media types', () => {
    // The client stays in exploration, read-only: the toggle does not appear in
    // the merged header, whatever the number of modes of the media.
    for (const kind of KINDS) expect(canSwitchMode('CLIENT', switcherModesFor(kind).length)).toBe(false);
  });

  it('offers it to internal roles as soon as there is more than one mode', () => {
    for (const role of INTERNAL)
      for (const kind of KINDS) expect(canSwitchMode(role, switcherModesFor(kind).length)).toBe(true);
  });

  it('hides it when a single mode remains — a single segment switches to nothing', () => {
    // The edit mount's player only has "watch".
    expect(canSwitchMode('ADMIN', 1)).toBe(false);
    expect(canSwitchMode('ADMIN', 0)).toBe(false);
  });
});

describe('switcherModesFor', () => {
  it('never lists "Annotate" — annotation is armed from the comment space', () => {
    for (const kind of KINDS) {
      expect(modesFor(kind).map((m) => m.value)).toContain('annotate');
      expect(switcherModesFor(kind).map((m) => m.value)).not.toContain('annotate');
    }
  });

  it('keeps the default mode first in the toggle for the four types', () => {
    for (const kind of KINDS) expect(switcherModesFor(kind)[0]?.value).toBe(DEFAULT_MODE);
  });

  it('gives the same modes to video and image, and staging to the spatial ones', () => {
    // The video cut was removed (Phase 50): both flat media now carry the
    // same toggle. This test said the opposite — it is rewritten, not disabled.
    expect(switcherModesFor('VIDEO').map((m) => m.value)).toEqual(
      switcherModesFor('IMAGE').map((m) => m.value),
    );
    expect(switcherModesFor('MODEL_3D').map((m) => m.value)).toContain('stage');
    expect(switcherModesFor('SPLAT').map((m) => m.value)).toContain('stage');
  });
});

describe('allowedModesFor — "Compare" requires a neighbouring version', () => {
  it('removes the segment when there is nothing to compare', () => {
    expect(switcherModesFor('IMAGE', false).map((m) => m.value)).toEqual(['explore']);
    // Since the cut was removed, video is in the same boat: without a neighbouring
    // version, it only has "Watch" left.
    expect(switcherModesFor('VIDEO', false).map((m) => m.value)).toEqual(['explore']);
  });

  it('lets the toggle disappear when a flat media only has one mode left', () => {
    // Without a neighbouring version, only "Watch" remains: a single segment switches to
    // nothing, and the toggle disappears instead of showing up inert.
    for (const kind of ['IMAGE', 'VIDEO'] as const) {
      expect(canSwitchMode('ARTIST', switcherModesFor(kind, false).length)).toBe(false);
      expect(canSwitchMode('ARTIST', switcherModesFor(kind, true).length)).toBe(true);
    }
  });

  it('does not touch spatial media, which do not have this mode', () => {
    for (const kind of ['MODEL_3D', 'SPLAT'] as const)
      expect(allowedModesFor(kind, false).map((m) => m.value)).toEqual(modesFor(kind).map((m) => m.value));
  });
});

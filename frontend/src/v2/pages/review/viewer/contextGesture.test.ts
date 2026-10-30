// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { CONTEXT_TAP_MAX_MS, CONTEXT_TAP_SLOP_PX, isContextTap } from './contextGesture';
import { CLICK_SLOP_PX } from '../three/usdPicking';

describe('isContextTap — short right click vs. fly', () => {
  it('accepts a short, still click', () => {
    expect(isContextTap({ dx: 0, dy: 0, heldMs: 0 })).toBe(true);
    expect(isContextTap({ dx: 2, dy: 2, heldMs: 120 })).toBe(true);
  });

  it('rejects a dragged click — the mouse was steering the view', () => {
    expect(isContextTap({ dx: CONTEXT_TAP_SLOP_PX + 1, dy: 0, heldMs: 10 })).toBe(false);
    expect(isContextTap({ dx: 0, dy: 40, heldMs: 10 })).toBe(false);
  });

  it('rejects a click held in place — the user was about to move with the keyboard', () => {
    expect(isContextTap({ dx: 0, dy: 0, heldMs: CONTEXT_TAP_MAX_MS + 1 })).toBe(false);
    expect(isContextTap({ dx: 0, dy: 0, heldMs: 3000 })).toBe(false);
  });

  it('shares the stillness tolerance of the left click — a single value in the codebase', () => {
    expect(CONTEXT_TAP_SLOP_PX).toBe(CLICK_SLOP_PX);
  });
});

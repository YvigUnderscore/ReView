// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { CONTEXT_TAP_MAX_MS, CONTEXT_TAP_SLOP_PX, isContextTap } from './contextGesture';
import { CLICK_SLOP_PX } from '../three/usdPicking';

describe('isContextTap — clic droit bref contre vol', () => {
  it('accepte un clic court et immobile', () => {
    expect(isContextTap({ dx: 0, dy: 0, heldMs: 0 })).toBe(true);
    expect(isContextTap({ dx: 2, dy: 2, heldMs: 120 })).toBe(true);
  });

  it('refuse un clic glissé — la souris a dirigé le regard', () => {
    expect(isContextTap({ dx: CONTEXT_TAP_SLOP_PX + 1, dy: 0, heldMs: 10 })).toBe(false);
    expect(isContextTap({ dx: 0, dy: 40, heldMs: 10 })).toBe(false);
  });

  it('refuse un clic maintenu en place — on s’apprêtait à avancer au clavier', () => {
    expect(isContextTap({ dx: 0, dy: 0, heldMs: CONTEXT_TAP_MAX_MS + 1 })).toBe(false);
    expect(isContextTap({ dx: 0, dy: 0, heldMs: 3000 })).toBe(false);
  });

  it('partage la tolérance d’immobilité du clic gauche — une seule valeur dans le dépôt', () => {
    expect(CONTEXT_TAP_SLOP_PX).toBe(CLICK_SLOP_PX);
  });
});

// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { pickPreselectedStatus, reviewStatusStyle } from './reviewDecision.helpers';

describe('reviewStatusStyle', () => {
  it('keeps the studio tint for the background and border', () => {
    const style = reviewStatusStyle('#2ECC71', true);
    expect(style.backgroundColor).toContain('145'); // tint of the original green
    expect(style.borderColor).toContain('0.4');
  });

  it('darkens the background when selected', () => {
    expect(reviewStatusStyle('#2ECC71', true, true).backgroundColor).toContain('0.28');
    expect(reviewStatusStyle('#2ECC71', true, false).backgroundColor).toContain('0.15');
  });

  it('brings the text up to the theme readability threshold', () => {
    // Navy blue: unreadable as is on the dark theme, so it must be lightened.
    const dark = reviewStatusStyle('#1b2a5e', true);
    const light = reviewStatusStyle('#1b2a5e', false);
    expect(dark.color).not.toBe(light.color);
    expect(lightnessOf(dark.color)).toBeGreaterThan(lightnessOf(light.color));
  });

  it('falls back on the raw colour if it is not usable', () => {
    expect(reviewStatusStyle('pas-une-couleur', true).color).toBe('pas-une-couleur');
  });
});

/** Lightness (`L%`) of an `hsl(H S% L%)` colour. */
function lightnessOf(value: string): number {
  return Number(value.match(/-?[\d.]+/g)![2]);
}

describe('pickPreselectedStatus', () => {
  const statuses = [
    { id: 1, isDefault: false },
    { id: 2, isDefault: true },
    { id: 3, isDefault: false },
  ];
  it('prioritises the current decision', () => {
    expect(pickPreselectedStatus({ id: 3 }, statuses)).toBe(3);
  });
  it('falls back on the studio default status', () => {
    expect(pickPreselectedStatus(null, statuses)).toBe(2);
  });
  it('null without a decision or a default', () => {
    expect(pickPreselectedStatus(null, [{ id: 1, isDefault: false }])).toBeNull();
  });
});

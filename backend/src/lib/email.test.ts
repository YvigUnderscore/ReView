// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { normalizeEmail } from './email';

describe('normalizeEmail', () => {
  it('lowercases and trims surrounding spaces', () => {
    expect(normalizeEmail('Alice@Studio.com')).toBe('alice@studio.com');
    expect(normalizeEmail('  BOB@studio.com \n')).toBe('bob@studio.com');
  });

  // OIDC SSO matches accounts on an email already lowercased by the provider: without this normalisation
  // on write, `Alice@…` and `alice@…` would be two accounts the uniqueness constraint does not match.
  it('makes case variants of the same address identical', () => {
    expect(normalizeEmail('CEO@studio.com')).toBe(normalizeEmail('ceo@studio.com'));
  });

  it('does not merge legitimately distinct addresses', () => {
    // Dots and sub-addressing are specific to some providers: we do not touch them.
    expect(normalizeEmail('a.b@studio.com')).not.toBe(normalizeEmail('ab@studio.com'));
    expect(normalizeEmail('a+vfx@studio.com')).not.toBe(normalizeEmail('a@studio.com'));
  });
});

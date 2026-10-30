// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { deviceLabel } from './deviceLabel';

describe('deviceLabel', () => {
  it('recognises Chrome/Windows', () => {
    expect(
      deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36'),
    ).toBe('Chrome · Windows');
  });
  it('Edge takes precedence over Chrome (the Edge UA contains chrome/)', () => {
    expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0) Chrome/126.0 Safari/537.36 Edg/126.0')).toBe(
      'Edge · Windows',
    );
  });
  it('Safari on macOS and iOS', () => {
    expect(deviceLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/17.0 Safari/605.1')).toBe(
      'Safari · macOS',
    );
    expect(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Version/17.0 Safari/604.1')).toBe(
      'Safari · iOS',
    );
  });
  it('falls back to unknown', () => {
    expect(deviceLabel(null)).toBe('Unknown device');
    // This fallback used to be "Navigateur" — a French literal shown in all fourteen languages
    // in the profile's active sessions list. The assertion was freezing the mistake.
    expect(deviceLabel('curl/8.0')).toBe('Browser');
  });

  it('no label escapes translation', () => {
    // The `check-untranslated` detector only reads JSX: a literal placed in a `lib/` module is
    // invisible to it. This assertion takes the place of the missing check.
    expect(deviceLabel('curl/8.0')).not.toMatch(/Navigateur/);
  });
});

// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { urlBase64ToUint8Array, pushSupported } from './webpush';

describe('webpush — urlBase64ToUint8Array (42.B №66)', () => {
  it('decodes base64url (with - and _) and handles missing padding', () => {
    // "ab-_" in base64url → base64 "ab+/" (padding added) → 3 bytes.
    const out = urlBase64ToUint8Array('ab-_');
    expect(out).toBeInstanceOf(Uint8Array);
    expect(out.length).toBe(3);
  });

  it('reproduces a known base64 decoding', () => {
    // atob('QUJD') === 'ABC' → [65, 66, 67]
    expect(Array.from(urlBase64ToUint8Array('QUJD'))).toEqual([65, 66, 67]);
  });

  it('pushSupported returns a boolean (false under happy-dom without PushManager)', () => {
    expect(typeof pushSupported()).toBe('boolean');
  });
});

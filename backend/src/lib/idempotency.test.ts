// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { fingerprint } from './idempotency';

describe('fingerprint', () => {
  it('is stable for the same replayed request', () => {
    expect(fingerprint('k1', 'POST', '/api/v1/publish', 7)).toBe(
      fingerprint('k1', 'POST', '/api/v1/publish', 7),
    );
  });

  it('separates two tokens carrying the same key', () => {
    expect(fingerprint('k1', 'POST', '/api/v1/publish', 7)).not.toBe(
      fingerprint('k1', 'POST', '/api/v1/publish', 8),
    );
  });

  it('separates an anonymous session from a token', () => {
    expect(fingerprint('k1', 'POST', '/api/v1/publish')).not.toBe(
      fingerprint('k1', 'POST', '/api/v1/publish', 7),
    );
  });

  it('separates two endpoints and two methods', () => {
    expect(fingerprint('k1', 'POST', '/api/v1/publish', 7)).not.toBe(
      fingerprint('k1', 'POST', '/api/v1/projects', 7),
    );
    expect(fingerprint('k1', 'POST', '/api/v1/publish', 7)).not.toBe(
      fingerprint('k1', 'PATCH', '/api/v1/publish', 7),
    );
  });

  it('produces a hexadecimal sha256 fingerprint', () => {
    expect(fingerprint('k', 'POST', '/x')).toMatch(/^[0-9a-f]{64}$/);
  });
});

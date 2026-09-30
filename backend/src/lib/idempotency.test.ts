// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { fingerprint } from './idempotency';

describe('fingerprint', () => {
  it('est stable pour une même requête rejouée', () => {
    expect(fingerprint('k1', 'POST', '/api/v1/publish', 7)).toBe(
      fingerprint('k1', 'POST', '/api/v1/publish', 7),
    );
  });

  it('sépare deux tokens portant la même clé', () => {
    expect(fingerprint('k1', 'POST', '/api/v1/publish', 7)).not.toBe(
      fingerprint('k1', 'POST', '/api/v1/publish', 8),
    );
  });

  it('sépare une session anonyme d’un token', () => {
    expect(fingerprint('k1', 'POST', '/api/v1/publish')).not.toBe(
      fingerprint('k1', 'POST', '/api/v1/publish', 7),
    );
  });

  it('sépare deux endpoints et deux méthodes', () => {
    expect(fingerprint('k1', 'POST', '/api/v1/publish', 7)).not.toBe(
      fingerprint('k1', 'POST', '/api/v1/projects', 7),
    );
    expect(fingerprint('k1', 'POST', '/api/v1/publish', 7)).not.toBe(
      fingerprint('k1', 'PATCH', '/api/v1/publish', 7),
    );
  });

  it('produit une empreinte sha256 hexadécimale', () => {
    expect(fingerprint('k', 'POST', '/x')).toMatch(/^[0-9a-f]{64}$/);
  });
});

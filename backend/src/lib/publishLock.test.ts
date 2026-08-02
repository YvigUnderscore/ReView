// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { assertNotPublished } from './publishLock';
import { AppError } from './errors';

describe('publishLock.assertNotPublished — verrou de publication (Phase 11)', () => {
  it('laisse passer un média non publié', () => {
    expect(() => assertNotPublished({ published: false })).not.toThrow();
  });

  it('refuse un média publié avec un 403 PUBLISHED_LOCKED', () => {
    try {
      assertNotPublished({ published: true });
      expect.fail('aurait dû lever');
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).statusCode).toBe(403);
      expect((e as AppError).code).toBe('PUBLISHED_LOCKED');
    }
  });
});

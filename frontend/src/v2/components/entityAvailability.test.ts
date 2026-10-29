// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { ApiError } from '../../lib/apiClient';
import { isBadId, isMissingOrForbidden } from './entityAvailability';

/**
 * The two guards that prevent an entity page from rendering for a nonexistent subject.
 * `/tasks/abc` displayed "Task #NaN" with an active drop zone, and `/shots/999999` a full shot page with
 * "+ New version".
 */
describe('isBadId', () => {
  it('rejects anything that cannot designate an entity', () => {
    expect(isBadId(Number('abc'))).toBe(true); // /tasks/abc → NaN
    expect(isBadId(0)).toBe(true);
    expect(isBadId(-3)).toBe(true);
    expect(isBadId(Number.POSITIVE_INFINITY)).toBe(true);
  });

  it('accepts a plausible identifier', () => {
    expect(isBadId(1)).toBe(false);
    expect(isBadId(8055)).toBe(false);
  });
});

describe('isMissingOrForbidden', () => {
  it('recognises absence and refusal', () => {
    expect(isMissingOrForbidden(new ApiError('nope', 404))).toBe(true);
    expect(isMissingOrForbidden(new ApiError('nope', 403))).toBe(true);
  });

  it('lets a server outage through, which deserves "Retry" rather than "no longer exists"', () => {
    expect(isMissingOrForbidden(new ApiError('boom', 500))).toBe(false);
    expect(isMissingOrForbidden(new ApiError('slow', 504))).toBe(false);
    expect(isMissingOrForbidden(new Error('offline'))).toBe(false);
    expect(isMissingOrForbidden(undefined)).toBe(false);
  });
});

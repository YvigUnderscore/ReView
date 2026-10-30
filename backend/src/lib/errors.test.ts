// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { AppError, badRequest, conflict, forbidden, notFound, unauthorized } from './errors';

/**
 * The error code is what the client translates: it is the code, not the English message, that decides the
 * language the user reads. These tests pin down the contract of the fallbacks.
 */
describe('typed errors', () => {
  it('carries status, message and code', () => {
    const err = badRequest('Empty path', 'PATH_EMPTY');
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe('Empty path');
    expect(err.code).toBe('PATH_EMPTY');
  });

  it('no argument: English message and generic code', () => {
    expect(unauthorized()).toMatchObject({
      statusCode: 401,
      message: 'Not authenticated',
      code: 'UNAUTHENTICATED',
    });
    expect(notFound()).toMatchObject({ statusCode: 404, message: 'Resource not found', code: 'NOT_FOUND' });
    expect(forbidden()).toMatchObject({ statusCode: 403, message: 'Access denied', code: 'FORBIDDEN' });
  });

  it('specific message without code: no generic code set', () => {
    // Otherwise the client would display "Resource not found" in place of the precise wording written by
    // the caller — translation is progress, not a loss of information.
    expect(notFound('Media not found').code).toBeUndefined();
  });

  it('specific message and code: both are kept', () => {
    expect(notFound('Shot not found', 'SHOT_NOT_FOUND')).toMatchObject({
      message: 'Shot not found',
      code: 'SHOT_NOT_FOUND',
    });
  });

  it('conflict and invalid request require their message', () => {
    expect(conflict('Code already taken', 'CODE_TAKEN')).toMatchObject({
      statusCode: 409,
      code: 'CODE_TAKEN',
    });
    expect(badRequest('Bad key').code).toBeUndefined();
  });
});

// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Request } from 'express';
import { describe, expect, it } from 'vitest';
import { AppError } from '../lib/errors';
import { isAuthed, requireUser } from './authUser';

const user = { id: 7, email: 'a@b.c', role: 'ARTIST' as const };

describe('requireUser', () => {
  it('returns the user set by authenticate', () => {
    expect(requireUser({ user } as Request)).toBe(user);
  });

  it('a route mounted without authenticate answers 401, not a TypeError', () => {
    let thrown: unknown;
    try {
      requireUser({} as Request);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError).statusCode).toBe(401);
  });
});

describe('isAuthed', () => {
  it('narrows the request type', () => {
    const req = { user } as Request;
    expect(isAuthed(req)).toBe(true);
    if (isAuthed(req)) expect(req.user.id).toBe(7);
    expect(isAuthed({} as Request)).toBe(false);
  });
});

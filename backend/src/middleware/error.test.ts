// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AppError } from '../lib/errors';
import { errorHandler, prismaErrorResponse } from './error';

/** Express response double: we only keep what the client would see. */
function responseSpy() {
  const sent: { status?: number; body?: Record<string, unknown> } = {};
  const res = {
    status(code: number) {
      sent.status = code;
      return this;
    },
    json(body: Record<string, unknown>) {
      sent.body = body;
      return this;
    },
  };
  return { res: res as unknown as Response, sent };
}

/** Request carrying a silent logger: the handler logs unhandled errors. */
const request = () =>
  ({ log: { error: vi.fn(), warn: vi.fn() } }) as unknown as Request & {
    log: { error: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> };
  };

const prismaError = (code: string, meta?: Record<string, unknown>) =>
  new Prisma.PrismaClientKnownRequestError(`prisma ${code} on model Secret`, {
    code,
    clientVersion: 'test',
    meta,
  });

const next = (() => undefined) as NextFunction;

describe('errorHandler', () => {
  it('application error: status, message and client code', () => {
    const { res, sent } = responseSpy();
    errorHandler(new AppError('Project is archived', 403, 'PROJECT_ARCHIVED'), request(), res, next);
    expect(sent.status).toBe(403);
    expect(sent.body).toEqual({ error: 'Project is archived', code: 'PROJECT_ARCHIVED' });
  });

  it('application error: details accompany the code', () => {
    const { res, sent } = responseSpy();
    errorHandler(new AppError('Locked', 409, 'SG_LOCKED', { url: 'https://sg/x' }), request(), res, next);
    expect(sent.body).toMatchObject({ code: 'SG_LOCKED', url: 'https://sg/x' });
  });

  it('schema rejected: 400 with a translatable code and the offending fields', () => {
    const { res, sent } = responseSpy();
    const parsed = z.object({ email: z.string().email() }).safeParse({ email: 'x' });
    errorHandler(parsed.success ? null : parsed.error, request(), res, next);
    expect(sent.status).toBe(400);
    expect(sent.body).toMatchObject({ error: 'Validation failed', code: 'VALIDATION_FAILED' });
    expect(sent.body?.details).toHaveProperty('email');
  });

  it('unhandled error: anonymous, coded and logged 500', () => {
    const { res, sent } = responseSpy();
    const req = request();
    errorHandler(new Error('secret de la stack'), req, res, next);
    expect(sent.status).toBe(500);
    expect(sent.body).toEqual({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(sent.body)).not.toContain('secret');
    expect(req.log.error).toHaveBeenCalledTimes(1);
  });

  it('both responses built here carry a code, like typed errors', () => {
    // Without a code, the two most frequent faults would be the only ones left in English in an
    // interface translated into fourteen languages.
    for (const err of [
      new Error('x'),
      z.string().safeParse(1).success ? null : z.string().safeParse(1).error,
    ]) {
      const { res, sent } = responseSpy();
      errorHandler(err, request(), res, next);
      expect(sent.body?.code).toBeTruthy();
    }
  });

  it('P2002 uniqueness violation: 409 conflict with the constrained fields, no schema leak', () => {
    const { res, sent } = responseSpy();
    const req = request();
    errorHandler(prismaError('P2002', { target: ['projectId', 'name'] }), req, res, next);
    expect(sent.status).toBe(409);
    expect(sent.body).toEqual({
      error: 'Resource already exists',
      code: 'CONFLICT',
      fields: ['projectId', 'name'],
    });
    expect(JSON.stringify(sent.body)).not.toContain('Secret');
    expect(req.log.warn).toHaveBeenCalledTimes(1);
    expect(req.log.error).not.toHaveBeenCalled();
  });

  it('P2002 with a string target or no target', () => {
    expect(prismaErrorResponse(prismaError('P2002', { target: 'User_email_key' }))?.body.fields).toEqual([
      'User_email_key',
    ]);
    expect(prismaErrorResponse(prismaError('P2002'))?.body).toEqual({
      error: 'Resource already exists',
      code: 'CONFLICT',
    });
  });

  it('P2025 record not found: 404', () => {
    const { res, sent } = responseSpy();
    errorHandler(prismaError('P2025', { cause: 'Record to update not found.' }), request(), res, next);
    expect(sent.status).toBe(404);
    expect(sent.body).toEqual({ error: 'Resource not found', code: 'NOT_FOUND' });
  });

  it('other Prisma errors stay unhandled 500s', () => {
    const { res, sent } = responseSpy();
    const req = request();
    errorHandler(prismaError('P1001'), req, res, next);
    expect(sent.status).toBe(500);
    expect(req.log.error).toHaveBeenCalledTimes(1);
    expect(prismaErrorResponse(new Error('x'))).toBeNull();
  });
});

// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors';
import { logger } from '../lib/logger';

/**
 * Global error handler. Standardizes JSON responses and never leaks a stack trace to the client.
 * Must be mounted last.
 *
 * The body always carries two fields: `error`, an **English** text intended for logs and
 * integrators, and `code`, a stable identifier that the client translates into the reader's
 * language (`error.<CODE>` in the front-end catalog). The two responses built here (a rejected Zod
 * schema, an unhandled error) therefore carry a code like the `AppError`s do, otherwise the two
 * most common faults would be the only ones left untranslated.
 */

/**
 * Prisma failures that describe a client mistake rather than a server fault, mapped once here so that
 * no route has to catch them: a uniqueness violation (P2002) is a conflict, a record missing at
 * `update`/`delete` time (P2025) is a not-found. Anything else stays an unhandled 500.
 *
 * The response carries the constrained fields (P2002 `meta.target`) only — never the model or the query,
 * which would expose the schema.
 */
export function prismaErrorResponse(
  err: unknown,
): { status: number; body: { error: string; code: string; fields?: string[] } } | null {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return null;
  if (err.code === 'P2002') {
    const target = err.meta?.target;
    const fields = Array.isArray(target)
      ? target.filter((f): f is string => typeof f === 'string')
      : typeof target === 'string'
        ? [target]
        : undefined;
    return {
      status: 409,
      body: { error: 'Resource already exists', code: 'CONFLICT', ...(fields?.length ? { fields } : {}) },
    };
  }
  if (err.code === 'P2025') {
    return { status: 404, body: { error: 'Resource not found', code: 'NOT_FOUND' } };
  }
  return null;
}

export const errorHandler = (err: unknown, req: Request, res: Response, _next: NextFunction): void => {
  if (err instanceof ZodError) {
    res
      .status(400)
      .json({ error: 'Validation failed', code: 'VALIDATION_FAILED', details: err.flatten().fieldErrors });
    return;
  }

  if (err instanceof AppError) {
    res.status(err.statusCode).json({ error: err.message, code: err.code, ...(err.details ?? {}) });
    return;
  }

  const prismaMapped = prismaErrorResponse(err);
  if (prismaMapped) {
    (req.log ?? logger).warn({ err }, 'Prisma error mapped to a client error');
    res.status(prismaMapped.status).json(prismaMapped.body);
    return;
  }

  // Child logger correlated with the request id (pino-http) if available, otherwise the global logger.
  (req.log ?? logger).error({ err }, 'Unhandled error');
  res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
};

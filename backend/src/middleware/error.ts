// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Request, Response, NextFunction } from 'express';
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

  // Child logger correlated with the request id (pino-http) if available, otherwise the global logger.
  (req.log ?? logger).error({ err }, 'Erreur non gérée');
  res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
};

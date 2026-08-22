// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors';
import { logger } from '../lib/logger';

/**
 * Gestionnaire d'erreurs global. Standardise les réponses JSON et ne fuite jamais
 * de stack trace au client. Doit être monté en dernier.
 *
 * Le corps porte toujours deux champs : `error`, texte **anglais** destiné aux traces et
 * aux intégrateurs, et `code`, identifiant stable que le client traduit dans la langue du
 * lecteur (`error.<CODE>` au catalogue front). Les deux réponses fabriquées ici — schéma
 * Zod refusé, erreur non gérée — portent donc un code au même titre que les `AppError`,
 * sans quoi les deux fautes les plus courantes resteraient les seules à ne pas se traduire.
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

  // Logger enfant corrélé au request-id (pino-http) si disponible, sinon logger global.
  (req.log ?? logger).error({ err }, 'Erreur non gérée');
  res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
};

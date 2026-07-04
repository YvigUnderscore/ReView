import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors';
import { logger } from '../lib/logger';

/**
 * Gestionnaire d'erreurs global. Standardise les réponses JSON et ne fuite jamais
 * de stack trace au client. Doit être monté en dernier.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const errorHandler = (err: unknown, req: Request, res: Response, _next: NextFunction): void => {
  if (err instanceof ZodError) {
    res.status(400).json({ error: 'Validation échouée', details: err.flatten().fieldErrors });
    return;
  }

  if (err instanceof AppError) {
    res.status(err.statusCode).json({ error: err.message, code: err.code });
    return;
  }

  // Logger enfant corrélé au request-id (pino-http) si disponible, sinon logger global.
  (req.log ?? logger).error({ err }, 'Erreur non gérée');
  res.status(500).json({ error: 'Erreur interne du serveur' });
};

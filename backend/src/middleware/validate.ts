// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';

export type Schemas = {
  body?: z.ZodTypeAny;
  params?: z.ZodTypeAny;
  query?: z.ZodTypeAny;
};

/** Middleware de validation portant ses schémas — lus par le générateur OpenAPI. */
export interface ValidateMiddleware {
  (req: Request, res: Response, next: NextFunction): void;
  schemas: Schemas;
}

/**
 * Middleware de validation Zod. Parse body/params/query selon les schémas fournis.
 * Note : en Express 5, `req.query` est en lecture seule → on mute via Object.assign.
 * Les erreurs Zod sont captées par le gestionnaire d'erreurs global.
 *
 * Les schémas sont exposés sur la fonction retournée : `lib/openapiRoutes` parcourt les
 * routeurs et les récupère pour décrire l'API. La documentation reste ainsi le reflet
 * exact de la validation, sans second endroit à tenir à jour.
 */
export const validate = (schemas: Schemas): ValidateMiddleware => {
  const middleware = (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (schemas.body) req.body = schemas.body.parse(req.body);
      if (schemas.params) Object.assign(req.params, schemas.params.parse(req.params));
      if (schemas.query) Object.assign(req.query, schemas.query.parse(req.query));
      next();
    } catch (err) {
      next(err);
    }
  };
  middleware.schemas = schemas;
  return middleware;
};

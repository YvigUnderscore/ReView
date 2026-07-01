import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';

type Schemas = {
  body?: z.ZodTypeAny;
  params?: z.ZodTypeAny;
  query?: z.ZodTypeAny;
};

/**
 * Middleware de validation Zod. Parse body/params/query selon les schémas fournis.
 * Note : en Express 5, `req.query` est en lecture seule → on mute via Object.assign.
 * Les erreurs Zod sont captées par le gestionnaire d'erreurs global.
 */
export const validate =
  (schemas: Schemas) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (schemas.body) req.body = schemas.body.parse(req.body);
      if (schemas.params) Object.assign(req.params, schemas.params.parse(req.params));
      if (schemas.query) Object.assign(req.query, schemas.query.parse(req.query));
      next();
    } catch (err) {
      next(err);
    }
  };

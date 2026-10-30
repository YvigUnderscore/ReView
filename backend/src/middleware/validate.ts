// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Request, Response, NextFunction } from 'express';
import type { Schemas } from '../lib/requestSchemas';

export type { Schemas };

/** Validation middleware carrying its schemas, read by the OpenAPI generator. */
export interface ValidateMiddleware {
  (req: Request, res: Response, next: NextFunction): void;
  schemas: Schemas;
}

/**
 * Zod validation middleware. Parses body, params and query according to the schemas provided.
 * Note: in Express 5, `req.query` is read-only, so we mutate it via Object.assign.
 * Zod errors are caught by the global error handler.
 *
 * The schemas are exposed on the returned function: `lib/openapiRoutes` walks the routers and
 * retrieves them to describe the API. The documentation thus stays an exact reflection of the
 * validation, with no second place to keep up to date.
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

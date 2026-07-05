import { Router } from 'express';
import { buildOpenApiDocument } from '../lib/openapi';

/**
 * Documentation API : spécification OpenAPI générée depuis Zod + interface Scalar.
 * - GET /api/openapi.json : document OpenAPI 3.0
 * - GET /api/docs         : explorateur interactif (Scalar, via CDN)
 * Endpoints publics en lecture (aucune donnée sensible : uniquement la forme de l'API).
 */
const router = Router();

router.get('/openapi.json', (_req, res) => {
  res.json(buildOpenApiDocument());
});

router.get('/docs', (_req, res) => {
  // CSP permissif limité à cette page : Scalar est chargé depuis un CDN.
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net 'unsafe-inline'; " +
      "style-src 'self' https://cdn.jsdelivr.net 'unsafe-inline'; font-src 'self' https: data:; " +
      "img-src 'self' data: https:; connect-src 'self'",
  );
  res.type('html').send(`<!doctype html>
<html>
  <head>
    <title>ReView API — Documentation</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body>
    <script id="api-reference" data-url="/api/openapi.json"></script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
  </body>
</html>`);
});

export default router;

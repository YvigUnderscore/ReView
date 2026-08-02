// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { buildOpenApiDocument } from '../lib/openapi';
import { getSourceUrl } from '../lib/settings';

/**
 * Documentation API : spécification OpenAPI générée depuis Zod + interface Scalar.
 * - GET /api/openapi.json : document OpenAPI 3.0
 * - GET /api/docs         : explorateur interactif (Scalar, via CDN)
 * Endpoints publics en lecture (aucune donnée sensible : uniquement la forme de l'API).
 *
 * Page publique = surface réseau au sens de l'AGPL §13 : elle porte donc, comme la page de
 * connexion et les partages client, le lien vers le code source correspondant.
 */
const router = Router();

/** L'URL atterrit dans un `href` : `safeSourceUrl` a filtré le protocole, on neutralise le reste. */
const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

router.get('/openapi.json', (_req, res) => {
  res.json(buildOpenApiDocument());
});

router.get('/docs', async (_req, res) => {
  const sourceUrl = escapeHtml(await getSourceUrl());
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
    <footer style="padding: 16px; text-align: center; font: 12px/1.5 system-ui, sans-serif; opacity: 0.7">
      ReView — Copyright © 2026 Yvig Bidon. Logiciel libre sous licence AGPL-3.0-or-later,
      fourni sans aucune garantie. <a href="${sourceUrl}" rel="noreferrer">Code source</a>
    </footer>
  </body>
</html>`);
});

export default router;

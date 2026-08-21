// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { buildOpenApiDocument } from '../lib/openapi';
import { getSourceUrl } from '../lib/settings';
// L'URL atterrit dans un `href` : `safeSourceUrl` a filtré le protocole, on neutralise le reste.
import { escapeHtml } from '../lib/html';

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

/**
 * Scalar est chargé depuis un CDN, sur l'origine de l'application, alors que les jetons de
 * session vivent en localStorage : une version compromise emporterait la session du premier
 * administrateur qui ouvre la doc, jeton de rafraîchissement compris. Trois garde-fous, à
 * tenir ensemble :
 *
 *  1. **version épinglée** — `@latest` implicite signifie « le code de demain, sans revue » ;
 *  2. **empreinte SRI** — le navigateur refuse le script si l'octet ne correspond pas, ce qui
 *     couvre la totalité du bundle (`standalone.js` est autonome : il ne charge aucun morceau
 *     annexe, sans quoi l'empreinte ne protégerait que le point d'entrée) ;
 *  3. **CSP resserrée** — plus de `'unsafe-inline'` sur les scripts, et la seule source
 *     autorisée est ce répertoire de cette version.
 *
 * ⚠ Monter la version = recalculer l'empreinte :
 *   `curl -s <SCALAR_SRC> | openssl dgst -sha384 -binary | openssl base64 -A`
 * La vraie correction reste d'embarquer le paquet dans les assets servis par Express — elle
 * demande une dépendance (et rend la doc lisible sur une instance coupée d'internet).
 */
const SCALAR_VERSION = '1.66.1';
const SCALAR_BASE = `https://cdn.jsdelivr.net/npm/@scalar/api-reference@${SCALAR_VERSION}/dist/browser/`;
const SCALAR_SRC = `${SCALAR_BASE}standalone.js`;
const SCALAR_SRI = 'sha384-RkhHYpdjsrJH9sH8RmczPchxNiHEhmW300QwMB/8yg6feduTZu9FBN4W0DJnp50Z';
/** Polices par défaut du thème Scalar — le seul autre tiers que la page contacte. */
const SCALAR_FONTS = 'https://fonts.scalar.com';

/**
 * `style-src` garde `'unsafe-inline'` : Scalar injecte sa feuille de style dans le document.
 * `script-src` ne l'a plus — le nonce couvre l'unique balise inline de la page, qui ne porte
 * d'ailleurs pas de code (elle transporte l'URL du document OpenAPI dans un attribut).
 */
const csp = (nonce: string): string =>
  [
    "default-src 'self'",
    `script-src 'nonce-${nonce}' ${SCALAR_BASE}`,
    "style-src 'self' 'unsafe-inline'",
    `font-src 'self' data: ${SCALAR_FONTS}`,
    "img-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');

router.get('/openapi.json', (_req, res) => {
  res.json(buildOpenApiDocument());
});

router.get('/docs', async (_req, res) => {
  const sourceUrl = escapeHtml(await getSourceUrl());
  const nonce = randomBytes(16).toString('base64');
  res.setHeader('Content-Security-Policy', csp(nonce));
  res.type('html').send(`<!doctype html>
<html>
  <head>
    <title>ReView API — Documentation</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body>
    <script nonce="${nonce}" id="api-reference" data-url="/api/openapi.json"></script>
    <script src="${SCALAR_SRC}" integrity="${SCALAR_SRI}" crossorigin="anonymous"></script>
    <footer style="padding: 16px; text-align: center; font: 12px/1.5 system-ui, sans-serif; opacity: 0.7">
      ReView — Copyright © 2026 Yvig Bidon. Logiciel libre sous licence AGPL-3.0-or-later,
      fourni sans aucune garantie. <a href="${sourceUrl}" rel="noreferrer">Code source</a>
    </footer>
  </body>
</html>`);
});

export default router;

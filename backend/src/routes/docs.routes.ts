// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { buildOpenApiDocument } from '../lib/openapi';
import { getSourceUrl } from '../lib/settings';
import { localeFromAcceptLanguage, t } from '../i18n';
// The URL lands in an `href`: `safeSourceUrl` has filtered the protocol, we neutralize the rest.
import { escapeHtml } from '../lib/html';

/**
 * API documentation: OpenAPI specification generated from Zod, plus the Scalar interface.
 * - GET /api/openapi.json: OpenAPI 3.0 document
 * - GET /api/docs: interactive explorer (Scalar, via CDN)
 * Public read-only endpoints (no sensitive data: only the shape of the API).
 *
 * A public page is a network surface in the sense of AGPL §13: like the login page and client shares,
 * it therefore carries the link to the corresponding source code.
 */
const router = Router();

/**
 * Scalar is loaded from a CDN, on the application's origin, whereas the session tokens live in
 * localStorage: a compromised version would take the session of the first administrator who opens the
 * docs, refresh token included. Three safeguards, to be held together:
 *
 *  1. **pinned version**: an implicit `@latest` means "tomorrow's code, unreviewed";
 *  2. **SRI fingerprint**: the browser refuses the script if the byte does not match, which covers the
 *     whole bundle (`standalone.js` is self-contained: it loads no side chunk, otherwise the fingerprint
 *     would only protect the entry point);
 *  3. **tightened CSP**: no more `'unsafe-inline'` on scripts, and the only allowed source is this
 *     directory of this version.
 *
 * ⚠ Bumping the version means recomputing the fingerprint:
 *   `curl -s <SCALAR_SRC> | openssl dgst -sha384 -binary | openssl base64 -A`
 * The real fix remains to embed the package in the assets served by Express: it requires a dependency
 * (and makes the docs readable on an instance cut off from the internet).
 */
const SCALAR_VERSION = '1.66.1';
const SCALAR_BASE = `https://cdn.jsdelivr.net/npm/@scalar/api-reference@${SCALAR_VERSION}/dist/browser/`;
const SCALAR_SRC = `${SCALAR_BASE}standalone.js`;
const SCALAR_SRI = 'sha384-RkhHYpdjsrJH9sH8RmczPchxNiHEhmW300QwMB/8yg6feduTZu9FBN4W0DJnp50Z';
/** Default Scalar theme fonts: the only other third party the page contacts. */
const SCALAR_FONTS = 'https://fonts.scalar.com';

/**
 * `style-src` keeps `'unsafe-inline'`: Scalar injects its stylesheet into the document.
 * `script-src` no longer has it: the nonce covers the page's only inline tag, which moreover carries no
 * code (it carries the URL of the OpenAPI document in an attribute).
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

router.get('/docs', async (req, res) => {
  const sourceUrl = escapeHtml(await getSourceUrl());
  const nonce = randomBytes(16).toString('base64');
  // Public page: no account, hence no saved preference: the language is negotiated on the header. The
  // AGPL §13 notice was hard-coded IN FRENCH here, whereas the same notice is rendered in English by the
  // front end: a legal notice cannot depend on the entry door. Both surfaces now share the `license.*` keys.
  const locale = localeFromAcceptLanguage(req.headers['accept-language']);
  res.setHeader('Content-Security-Policy', csp(nonce));
  // `Vary`: without it, an intermediate cache would serve the French version to everyone.
  res.setHeader('Vary', 'Accept-Language');
  res.type('html').send(`<!doctype html>
<html lang="${escapeHtml(locale)}">
  <head>
    <title>ReView API — Documentation</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body>
    <script nonce="${nonce}" id="api-reference" data-url="/api/openapi.json"></script>
    <script src="${SCALAR_SRC}" integrity="${SCALAR_SRI}" crossorigin="anonymous"></script>
    <footer style="padding: 16px; text-align: center; font: 12px/1.5 system-ui, sans-serif; opacity: 0.7">
      ${escapeHtml(t(locale, 'license.notice'))}
      <a href="${sourceUrl}" rel="noreferrer">${escapeHtml(t(locale, 'license.source'))}</a>
    </footer>
  </body>
</html>`);
});

export default router;

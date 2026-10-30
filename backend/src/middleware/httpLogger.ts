// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { pinoHttp, type Options } from 'pino-http';
import { stdSerializers } from 'pino';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { logger } from '../lib/logger';

/** Marker placed in place of a secret, same form as pino's native redaction. */
const REDACTED = '[Redacted]';

/**
 * Tokens carried by the PATH rather than by the query: four public surfaces identify themselves by a
 * URL segment that IS the secret.
 *
 * - `/api/shotgrid/webhook/<token>`: the right to write fake events;
 * - `/api/auth/invitation/<token>`: sets a password and opens a session (7 days);
 * - `/api/client/<token>`: guest access to a project share;
 * - `/api/unsubscribe/<token>`: switches off a mailing preference.
 *
 * Without this masking, whoever reads the application logs takes the account before its recipient:
 * it is the same reflex as for an authorization header.
 *
 * `/api/share/<id>` is deliberately not listed: its segment is the numeric identifier of a link, not
 * its token. Masking it would remove no secret and would deprive the log of the only information
 * useful for diagnosis.
 */
const TOKEN_IN_PATH = /^(\/api\/(?:shotgrid\/webhook|auth\/invitation|client|unsubscribe)\/)[^/?#]+/i;

/**
 * Names of query parameters whose VALUE is a secret. We reason by name rather than by a closed list:
 * a parameter invented tomorrow (`sessionToken`, `apiKey`…) is thus masked by default, even if this
 * occasionally masks a harmless value.
 */
const SECRET_PARAM_SUBSTRING = /token|secret|password|passwd|signature|credential|key|auth/i;

/** Short names that no substring catches (`?code=` of the OIDC callback, for example). */
const SECRET_PARAM_EXACT = new Set(['code', 'state', 'sig', 'jwt', 'pwd', 'otp']);

function isSecretParam(rawName: string): boolean {
  let name = rawName;
  try {
    name = decodeURIComponent(rawName);
  } catch {
    // Badly encoded name: we judge the raw form rather than giving up on masking.
  }
  return SECRET_PARAM_SUBSTRING.test(name) || SECRET_PARAM_EXACT.has(name.toLowerCase());
}

/** Replaces the value of sensitive parameters, keeping the others as they are. */
function redactQuery(query: string): string {
  return query
    .split('&')
    .map((pair) => {
      const eq = pair.indexOf('=');
      if (eq < 0) return pair;
      const name = pair.slice(0, eq);
      return isSecretParam(name) ? `${name}=${REDACTED}` : pair;
    })
    .join('&');
}

/**
 * Loggable URL: path and query stripped of any token.
 *
 * Exported so it can be tested: this is the only barrier between a single-use secret and a log file
 * kept for months.
 */
export function redactUrl(url: string): string {
  const qi = url.indexOf('?');
  const path = (qi < 0 ? url : url.slice(0, qi)).replace(TOKEN_IN_PATH, `$1${REDACTED}`);
  if (qi < 0) return path;
  return `${path}?${redactQuery(url.slice(qi + 1))}`;
}

/**
 * Paths of the automatic probes: container liveness and availability, and Prometheus scraping,
 * mounted outside `/api` as well as under it (app.ts mounts `healthRoutes` at both).
 *
 * The docker healthcheck polls `/health` every 10 s and Prometheus `/metrics` every 15 s: about
 * 14,400 lines per day carrying no diagnostic information, charged against the 50 MB docker rotation
 * budget. `/health/ready` is listed because the compose file explicitly plans to use it as a probe
 * (HEALTH_PATH).
 */
const PROBE_PATHS = new Set([
  '/health',
  '/health/live',
  '/health/ready',
  '/api/health',
  '/api/health/live',
  '/api/health/ready',
  '/metrics',
]);

/**
 * Is the request an automatic probe?
 *
 * We compare the PATH alone: Prometheus appends `?token=…` when METRICS_TOKEN is set, and a comparison
 * on the whole URL would then let all the noise through. The trailing slash is tolerated (`/health/`
 * is the same route on the Express side).
 */
export function isProbeRequest(url: string | undefined): boolean {
  if (!url) return false;
  const cut = url.search(/[?#]/);
  const path = cut < 0 ? url : url.slice(0, cut);
  return PROBE_PATHS.has(path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path);
}

/**
 * HTTP logging options, exported WITHOUT the application's logger.
 *
 * The real logger is `silent` in the test environment: counting lines through it would prove nothing.
 * The suite therefore recreates a `pinoHttp` with these same options and a stream it can read: it is
 * the production configuration that gets measured, not a copy.
 */
export const httpLoggerOptions: Options = {
  // Reuse an `x-request-id` supplied upstream (reverse proxy), otherwise generate one, and return it
  // to the client for end-to-end correlation.
  genReqId: (req, res) => {
    const header = req.headers['x-request-id'];
    const id = (Array.isArray(header) ? header[0] : header) || randomUUID();
    res.setHeader('x-request-id', id);
    return id;
  },
  customLogLevel: (req, res, err) => {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    // Successful probe: nothing to say. Silence is set HERE rather than in `autoLogging.ignore`, which
    // removes the response listeners and would therefore ALSO drop the probe's failure (pino-http/logger.js:
    // `shouldLogSuccess` gates `res.on('finish', …)`). Yet a healthcheck failure is exactly what an
    // operator comes to the log for: it stays logged by the two lines above.
    if (isProbeRequest(req.url)) return 'silent';
    return 'info';
  },
  // Never log secrets passing through a header.
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
    remove: true,
  },
  // Header redaction does not protect `req.url`: everything the URL carries goes in clear into the logs,
  // where pino runs at `info` up to production. So we wrap the standard serializer (above all no
  // passthrough: it would expose the whole request object).
  serializers: {
    req(req: IncomingMessage) {
      const serialized = stdSerializers.req(req);
      if (typeof serialized.url === 'string') serialized.url = redactUrl(serialized.url);
      return serialized;
    },
  },
};

/**
 * Structured HTTP logging (pino-http): one JSON line per request, with request id, method, URL, status
 * and duration. Attaches `req.log` (a child logger correlated with the request id), reusable in handlers
 * and in the error middleware.
 */
export const httpLogger = pinoHttp({ ...httpLoggerOptions, logger });

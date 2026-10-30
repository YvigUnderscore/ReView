// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import pino, { type LoggerOptions } from 'pino';
import { env } from '../config/env';

/**
 * The single structured logger of the application (backend + workers).
 *
 * - Level: explicit `LOG_LEVEL`, otherwise derived from `NODE_ENV`
 *   (`silent` in test, `info` in production, `debug` in development).
 * - Output: one-line JSON per event (aggregation/observability), except in development where
 *   `pino-pretty` colourises for local readability.
 * - The request-id and HTTP request logging are added by `pino-http` (see `middleware/httpLogger`).
 */
const level =
  env.LOG_LEVEL ?? (env.NODE_ENV === 'test' ? 'silent' : env.NODE_ENV === 'production' ? 'info' : 'debug');

/**
 * Fields never logged, wherever they appear in the object passed to the logger.
 *
 * HTTP log redaction covers the headers; this covers the rest — a ShotGrid site record, an SMTP form, an entity read
 * back from the database. A secret has no reason to reach a log file, and the oversight happens when one adds a
 * `logger.error({ site })` to debug something.
 */
const REDACTED_FIELDS = [
  'password',
  '*.password',
  '*.*.password',
  'scriptKey',
  '*.scriptKey',
  '*.*.scriptKey',
  'webhookSecret',
  '*.webhookSecret',
  'secret',
  '*.secret',
  'apiKey',
  '*.apiKey',
  'accessToken',
  '*.accessToken',
  'access_token',
  '*.access_token',
];

/**
/**
 * Output pretty-printer — **only if it is really there**.
 *
 * `pino-pretty` is a devDependency, and the runtime image is built with `npm ci --omit=dev`: it does not ship it.
 * Yet the development docker stack sets `NODE_ENV=development` on this same image (which disables the production
 * guards: strong secrets, strict CORS). Both decisions are sound on their own, but their meeting made pino throw
 * "unable to determine transport target for \"pino-pretty\"" **at module load**: the container did not start at
 * all, and the message said nothing about docker or NODE_ENV.
 *
 * A log pretty-printer must never be the reason a process refuses to start. It is therefore requested only if the
 * package is installed, and otherwise we fall back to JSON — which is in any case what we want once aggregating.
 */
export function prettyTransport(
  nodeEnv: string,
  isInstalled: (name: string) => boolean,
): LoggerOptions['transport'] | undefined {
  if (nodeEnv !== 'development' || !isInstalled('pino-pretty')) return undefined;
  return {
    target: 'pino-pretty',
    options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' },
  };
}

/** Is the package resolvable from this module? `require.resolve` does not execute it. */
const isInstalled = (name: string): boolean => {
  try {
    require.resolve(name);
    return true;
  } catch {
    return false;
  }
};

const transport = prettyTransport(env.NODE_ENV, isInstalled);

const options: LoggerOptions = {
  level,
  redact: { paths: REDACTED_FIELDS, censor: '[Redacted]' },
  ...(transport ? { transport } : {}),
};

export const logger = pino(options);

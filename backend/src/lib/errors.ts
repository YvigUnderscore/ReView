// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Application error with an HTTP code — caught by the global error middleware.
 */
export class AppError extends Error {
  statusCode: number;
  code?: string;
  /**
   * Data the client needs in order to offer the user a next step — for example the creation link on the
   * ShotGrid side when local creation is locked. A message alone would force the interface to parse it.
   */
  details?: Record<string, unknown>;

  constructor(message: string, statusCode = 500, code?: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

/**
 * Error factory with a message and a fallback code.
 *
 * The code travels to the client (`middleware/error`), which translates with it: it is the only way for an
 * interface in fourteen languages to display an API error in the reader's language, the English message
 * remaining a trace. The fallback code is set **only** when the message is too: a caller who writes "Media not
 * found" says something more precise than "not found", and attaching the generic code would display the
 * generic translation in its place. Without a code, the client shows the server's message — degraded, but
 * never wrong.
 */
const withFallback =
  (statusCode: number, fallbackMessage: string, fallbackCode: string) => (msg?: string, code?: string) =>
    new AppError(msg ?? fallbackMessage, statusCode, code ?? (msg === undefined ? fallbackCode : undefined));

export const badRequest = (msg: string, code?: string) => new AppError(msg, 400, code);
export const unauthorized = withFallback(401, 'Not authenticated', 'UNAUTHENTICATED');
export const forbidden = withFallback(403, 'Access denied', 'FORBIDDEN');
export const notFound = withFallback(404, 'Resource not found', 'NOT_FOUND');
export const conflict = (msg: string, code?: string) => new AppError(msg, 409, code);

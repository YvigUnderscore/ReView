// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Erreur applicative avec code HTTP — captée par le middleware d'erreur global.
 */
export class AppError extends Error {
  statusCode: number;
  code?: string;
  /**
   * Données que le client doit recevoir pour proposer une suite à l'utilisateur —
   * par exemple le lien de création côté ShotGrid quand la création locale est
   * verrouillée. Un message seul obligerait l'interface à le réanalyser.
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

export const badRequest = (msg: string, code?: string) => new AppError(msg, 400, code);
export const unauthorized = (msg = 'Non authentifié', code?: string) => new AppError(msg, 401, code);
export const forbidden = (msg = 'Access denied', code?: string) => new AppError(msg, 403, code);
export const notFound = (msg = 'Ressource introuvable', code?: string) => new AppError(msg, 404, code);
export const conflict = (msg: string, code?: string) => new AppError(msg, 409, code);

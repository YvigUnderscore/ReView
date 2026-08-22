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

/**
 * Fabrique d'erreur à message et code de repli.
 *
 * Le code voyage jusqu'au client (`middleware/error`), qui traduit par lui : c'est la
 * seule façon pour une interface en quatorze langues d'afficher une erreur d'API dans la
 * langue du lecteur, le message anglais restant une trace. Le code de repli n'est posé
 * **que** lorsque le message l'est aussi : un appelant qui rédige « Media not found » dit
 * quelque chose de plus précis que « not found », et lui coller le code générique ferait
 * afficher la traduction générique à sa place. Sans code, le client affiche le message
 * du serveur — dégradé, mais jamais faux.
 */
const withFallback =
  (statusCode: number, fallbackMessage: string, fallbackCode: string) => (msg?: string, code?: string) =>
    new AppError(msg ?? fallbackMessage, statusCode, code ?? (msg === undefined ? fallbackCode : undefined));

export const badRequest = (msg: string, code?: string) => new AppError(msg, 400, code);
export const unauthorized = withFallback(401, 'Not authenticated', 'UNAUTHENTICATED');
export const forbidden = withFallback(403, 'Access denied', 'FORBIDDEN');
export const notFound = withFallback(404, 'Resource not found', 'NOT_FOUND');
export const conflict = (msg: string, code?: string) => new AppError(msg, 409, code);

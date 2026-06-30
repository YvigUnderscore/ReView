/**
 * Erreur applicative avec code HTTP — captée par le middleware d'erreur global.
 */
export class AppError extends Error {
  statusCode: number;
  code?: string;

  constructor(message: string, statusCode = 500, code?: string) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export const badRequest = (msg: string, code?: string) => new AppError(msg, 400, code);
export const unauthorized = (msg = 'Non authentifié', code?: string) => new AppError(msg, 401, code);
export const forbidden = (msg = 'Accès refusé', code?: string) => new AppError(msg, 403, code);
export const notFound = (msg = 'Ressource introuvable', code?: string) => new AppError(msg, 404, code);
export const conflict = (msg: string, code?: string) => new AppError(msg, 409, code);

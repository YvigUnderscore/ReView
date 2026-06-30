import type { Role } from '@prisma/client';

/** Augmentation du type Request d'Express pour porter l'utilisateur authentifié. */
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: number;
        email: string;
        role: Role;
      };
    }
  }
}

export {};

// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

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
      /** Session de connexion (36.B) — présent quand le JWT porte un sid. */
      sessionId?: string;
      /** Authentification par token d'API (36.C) — scopes effectifs. */
      apiToken?: { id: number; scopes: string[] };
    }
  }
}

export {};

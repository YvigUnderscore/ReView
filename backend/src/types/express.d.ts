// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ApiTokenKind, Role } from '@prisma/client';

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
      /**
       * Authentification par token d'API (36.C) — scopes stockés (fins ou hérités),
       * nature du token et projet auquel il est éventuellement cantonné (API v1).
       */
      apiToken?: { id: number; scopes: string[]; projectId?: number; kind?: ApiTokenKind };
    }
  }
}

export {};

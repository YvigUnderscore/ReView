// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ApiTokenKind, Role } from '@prisma/client';

/** Augmentation of Express's Request type to carry the authenticated user. */
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: number;
        email: string;
        role: Role;
      };
      /** Connection session (36.B): present when the JWT carries a sid. */
      sessionId?: string;
      /**
       * Authentication by API token (36.C): stored scopes (fine-grained or inherited), the nature of the token and the project it is possibly confined to (API v1).
       */
      apiToken?: { id: number; scopes: string[]; projectId?: number; kind?: ApiTokenKind };
    }
  }
}

export {};

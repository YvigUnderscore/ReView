// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Role, UserStatus } from './api';

/** Fiche publique d'un membre du studio — GET /api/users/:id/profile. */
export interface UserProfile {
  id: number;
  displayName: string;
  initials: string;
  avatarUrl: string | null;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  jobTitle: string | null;
  bio: string | null;
  /** Coordonnées : absentes pour un lecteur CLIENT externe. */
  email?: string;
  phone?: string | null;
  role: Role;
  status: UserStatus;
  lastSeenAt: string | null;
  online: boolean;
  createdAt: string;
  /** Projets partagés avec le lecteur. */
  sharedProjects: { id: number; name: string }[];
  isSelf: boolean;
}

// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Role, UserStatus } from '../types/api';
import type { MessageKey } from '../i18n';

/** Couleurs et libellés des statuts de présence utilisateur (Avatar, SidebarFooter). */

export const STATUS_COLOR: Record<UserStatus, string> = {
  AVAILABLE: '#22c55e',
  AWAY: '#f59e0b',
  DND: '#ef4444',
};

/** Clé de traduction du statut : le libellé se résout au rendu, pas au chargement. */
export const STATUS_LABEL_KEY: Record<UserStatus, MessageKey> = {
  AVAILABLE: 'presence.available',
  AWAY: 'presence.away',
  DND: 'presence.dnd',
};

/** Libellé du rôle global, tel qu'affiché sur la fiche d'un membre. */
export const ROLE_LABEL_KEY: Record<Role, MessageKey> = {
  ADMIN: 'role.admin',
  SUPERVISOR: 'role.supervisor',
  ARTIST: 'role.artist',
  CLIENT: 'role.client',
};

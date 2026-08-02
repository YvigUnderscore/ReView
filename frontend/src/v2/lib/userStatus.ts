// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { UserStatus } from '../types/api';

/** Couleurs et libellés des statuts de présence utilisateur (Avatar, SidebarFooter). */

export const STATUS_COLOR: Record<UserStatus, string> = {
  AVAILABLE: '#22c55e',
  AWAY: '#f59e0b',
  DND: '#ef4444',
};

export const STATUS_LABEL: Record<UserStatus, string> = {
  AVAILABLE: 'Disponible',
  AWAY: 'Absent',
  DND: 'Ne pas déranger',
};

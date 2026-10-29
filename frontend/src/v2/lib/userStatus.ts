// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Role, UserStatus } from '../types/api';
import type { MessageKey } from '../i18n';

/** Colours and labels of user presence statuses (Avatar, SidebarFooter). */

export const STATUS_COLOR: Record<UserStatus, string> = {
  AVAILABLE: '#22c55e',
  AWAY: '#f59e0b',
  DND: '#ef4444',
};

/** Translation key of the status: the label is resolved at render time, not at load. */
export const STATUS_LABEL_KEY: Record<UserStatus, MessageKey> = {
  AVAILABLE: 'presence.available',
  AWAY: 'presence.away',
  DND: 'presence.dnd',
};

/** Label of the global role, as displayed on a member's sheet. */
export const ROLE_LABEL_KEY: Record<Role, MessageKey> = {
  ADMIN: 'role.admin',
  SUPERVISOR: 'role.supervisor',
  ARTIST: 'role.artist',
  CLIENT: 'role.client',
};

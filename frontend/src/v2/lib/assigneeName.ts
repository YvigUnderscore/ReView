// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { AssigneeRef } from '../types/entities';

/**
 * The name displayed for an assigned person: nickname, full name, then first name + last name.
 *
 * Same order as `displayName` on the server side (`lib/userView.ts`) — both must name the same
 * person the same way, otherwise an avatar and a team list would contradict each other on the same screen.
 */
export function assigneeName(person: AssigneeRef): string {
  if (person.username) return person.username;
  if (person.name) return person.name;
  const full = [person.firstName, person.lastName].filter(Boolean).join(' ').trim();
  return full || '—';
}

// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Role, User } from '../../types/api';
import { intlLocale } from '../../i18n';

/** Pure helpers for the Users admin page (search/filter/sort) — tested. */

export type UserSort = 'name' | 'role' | 'storage' | 'recent';

/** Displayable name of a user (handle > displayName > name > email). */
export function userLabel(u: User): string {
  return u.displayName ?? u.username ?? u.name ?? u.email;
}

/** Full-text filter (name, handle, email) + role, case-insensitive. */
export function filterUsers(users: User[], q: string, role: Role | 'ALL'): User[] {
  const needle = q.trim().toLowerCase();
  return users.filter((u) => {
    if (role !== 'ALL' && u.role !== role) return false;
    if (!needle) return true;
    return [u.displayName, u.username, u.name, u.firstName, u.lastName, u.email]
      .filter((v): v is string => Boolean(v))
      .some((v) => v.toLowerCase().includes(needle));
  });
}

const ROLE_ORDER: Record<Role, number> = { ADMIN: 0, SUPERVISOR: 1, ARTIST: 2, CLIENT: 3 };

/** Stable sort by the chosen criterion (copy, without mutating the original list). */
export function sortUsers(users: User[], sort: UserSort): User[] {
  const copy = [...users];
  switch (sort) {
    case 'name':
      return copy.sort((a, b) => userLabel(a).localeCompare(userLabel(b), intlLocale()));
    case 'role':
      return copy.sort(
        (a, b) =>
          ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || userLabel(a).localeCompare(userLabel(b), intlLocale()),
      );
    case 'storage':
      return copy.sort((a, b) => b.storageUsed - a.storageUsed);
    case 'recent':
      return copy.sort((a, b) => b.id - a.id);
  }
}

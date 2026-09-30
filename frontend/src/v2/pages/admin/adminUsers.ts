// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Role, User } from '../../types/api';
import { intlLocale } from '../../i18n';

/** Helpers purs de la page admin Utilisateurs (recherche/filtre/tri) — testés. */

export type UserSort = 'name' | 'role' | 'storage' | 'recent';

/** Nom affichable d'un utilisateur (pseudo > displayName > nom > email). */
export function userLabel(u: User): string {
  return u.displayName ?? u.username ?? u.name ?? u.email;
}

/** Filtre plein-texte (nom, pseudo, email) + rôle, insensible à la casse. */
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

/** Tri stable selon le critère choisi (copie, sans muter la liste d'origine). */
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

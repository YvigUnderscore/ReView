// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { AssigneeRef } from '../types/entities';

/**
 * Le nom qu'on affiche pour une personne assignée : pseudo, nom complet, puis prénom+nom.
 *
 * Même ordre que `displayName` côté serveur (`lib/userView.ts`) — les deux doivent nommer
 * la même personne de la même façon, sans quoi un avatar et une liste d'équipe se
 * contrediraient sur le même écran.
 */
export function assigneeName(person: AssigneeRef): string {
  if (person.username) return person.username;
  if (person.name) return person.name;
  const full = [person.firstName, person.lastName].filter(Boolean).join(' ').trim();
  return full || '—';
}

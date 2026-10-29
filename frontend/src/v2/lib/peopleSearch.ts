// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Role } from '../types/api';
import { intlLocale } from '../i18n';
// Same fallback as the palette: the module is already pure and tested, duplicating it here
// would let two definitions of "accent-insensitive" drift apart.
import { foldForSearch } from '../components/palette/paletteMatch';

/**
 * Pick a person from the directory — filtering, sorting and identity line.
 *
 * A studio lines up dozens of accounts, many of which share the same display name (twenty-seven
 * "IT Artist" in a row, observed in production): the list of names alone does not say which one is
 * the right one. Two answers, both here because they are pure and must be tested: the search covers
 * everything that identifies someone (name, email, job title, role), and the secondary line shows
 * what tells them apart — the job title and the email address, which is unique by construction.
 */

/** A person offered for selection. What is needed to recognise them, nothing more. */
export interface PersonOption {
  id: number;
  /** Displayed name, already resolved by the caller (see `personLabel`). */
  name: string;
  /** Email address: the only field that reliably tells two namesakes apart. */
  email?: string | null;
  /** Job title declared on the record ("Compositing lead"), when it exists. */
  jobTitle?: string | null;
  /** Role in the studio or on the project — displayed as a badge. */
  role?: Role | null;
  avatarUrl?: string | null;
  /** Initials computed by the server; failing that, the caller derives them from the name. */
  initials?: string;
  /** Machine account (API token): never offered unless explicitly required. */
  isService?: boolean;
}

export interface PeopleFilterOptions {
  /** The user's input — case, accents and surrounding spaces ignored. */
  query?: string;
  /** People already selected elsewhere (project members, thread recipients). */
  excludeIds?: readonly number[];
  /** Lets service accounts through (no screen asks for it today). */
  includeService?: boolean;
}

/** Raw identity as it arrives from the API, before the display name is resolved. */
export interface PersonIdentity {
  displayName?: string | null;
  username?: string | null;
  name?: string | null;
  email: string;
}

/**
 * Display name of an account.
 *
 * The server already computes `displayName` (nickname > name > first name + last name > email) and sends
 * it on most routes; the fallback covers the views that do not carry it yet. An invited account that
 * was never filled in only has its email address: that is what is displayed, rather than an empty line
 * nobody could click.
 */
export function personLabel(user: PersonIdentity): string {
  return user.displayName ?? user.username ?? user.name ?? user.email;
}

/** What tells two namesakes apart, on one line: the job title, then the email address. */
export function personSubtitle(person: PersonOption): string {
  return [person.jobTitle, person.email].filter((part): part is string => Boolean(part)).join(' · ');
}

/**
 * Does the person match the input?
 *
 * The role is compared on its technical value (`ARTIST`) and not on its translated label: like the
 * palette keys, it does not change from one language to another, and "admin" remains what someone
 * types when looking for an administrator.
 */
export function personMatches(person: PersonOption, query: string): boolean {
  const needle = foldForSearch(query.trim());
  if (!needle) return true;
  return [person.name, person.email, person.jobTitle, person.role]
    .filter((part): part is string => Boolean(part))
    .some((part) => foldForSearch(part).includes(needle));
}

/**
 * Retained candidates, sorted for reading.
 *
 * The secondary sort by email is not cosmetic: on a list of namesakes, it is the only stable order —
 * without it, two "IT Artist" swap places from one render to the next and the wrong one gets clicked.
 */
export function filterPeople(
  people: readonly PersonOption[],
  { query = '', excludeIds = [], includeService = false }: PeopleFilterOptions = {},
): PersonOption[] {
  const excluded = new Set(excludeIds);
  const locale = intlLocale();
  return people
    .filter((person) => includeService || !person.isService)
    .filter((person) => !excluded.has(person.id))
    .filter((person) => personMatches(person, query))
    .sort(
      (a, b) =>
        a.name.localeCompare(b.name, locale) ||
        (a.email ?? '').localeCompare(b.email ?? '', locale) ||
        a.id - b.id,
    );
}

/**
 * Which of the two empty messages to announce?
 *
 * An empty list does not say the same thing depending on whether a search was made. "No one matches
 * this search" over an empty field blames a search that never took place: what should be said is that
 * there is nobody to offer — and only the caller knows that (the whole studio is already a member, the
 * entity has no department…). As soon as a word is typed, on the other hand, it is indeed a matter of match.
 */
export function emptyPeopleReason(query: string): 'no-candidates' | 'no-match' {
  return query.trim() === '' ? 'no-candidates' : 'no-match';
}

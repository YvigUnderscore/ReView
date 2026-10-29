// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Role, UserStatus } from '@prisma/client';
import { storage } from './storage';
import { imageTypeFromKey } from './uploadContentType';

/** Raw identity fields of a user, as selected in the database. */
export interface RawUserIdentity {
  id: number;
  email: string;
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  username?: string | null;
  avatarKey?: string | null;
}

/** Identity, enriched profile (42.B №89) and role: what the user sees of their session. */
export interface RawSessionUser extends RawUserIdentity {
  jobTitle?: string | null;
  bio?: string | null;
  phone?: string | null;
  role: Role;
  status?: UserStatus;
}

/** Display name: username > legacy full name > first name + last name > email. */
export function displayName(u: RawUserIdentity): string {
  if (u.username) return u.username;
  if (u.name) return u.name;
  const full = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
  if (full) return full;
  return u.email;
}

/** Initials (1–2 letters) for the fallback avatar. */
export function initials(u: RawUserIdentity): string {
  const first = u.firstName?.[0];
  const last = u.lastName?.[0];
  if (first && last) return (first + last).toUpperCase();
  const name = displayName(u);
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    const a = parts[0]?.[0] ?? '';
    const b = parts[1]?.[0] ?? '';
    if (a && b) return (a + b).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

/** Presigned avatar URL (null if no avatar uploaded, so the front end falls back to initials). */
export async function avatarUrl(avatarKey?: string | null): Promise<string | null> {
  if (!avatarKey) return null;
  try {
    // Type imposed from the extension: the avatar is uploaded via presigned PUT, whose signature
    // does not constrain the Content-Type sent. An "avatar" served as text/html would run on the
    // app's origin when someone opens the URL.
    return await storage.getPresignedGetUrl(avatarKey, 3600, imageTypeFromKey(avatarKey));
  } catch {
    return null;
  }
}

/**
 * View of an author whose account has been deleted.
 *
 * Most author relations are `SetNull`: deleting an account leaves behind comments, decisions and
 * markers whose author is `null`. The public views dereferenced this author without care: a single
 * departure was enough to break every review thread the person had taken part in, with a 500 error.
 */
export const DELETED_USER_VIEW = {
  id: null,
  displayName: 'Compte supprimé',
  initials: '—',
  avatarUrl: null,
} as const;

/**
 * Like `toPublicUser`, but tolerates a missing author (deleted account).
 *
 * `externalName` distinguishes the two ways of having no account. A deleted account leaves nothing
 * behind: that is the case covered by `DELETED_USER_VIEW`. A guest, or a contributor who wrote from
 * ShotGrid, never had an account here but carries their name (`Comment.guestName`): returning
 * `null` lets the display fall back to that name. Confusing the two would present a living person
 * as a deleted account, which is wrong, and is what feedback coming from ShotGrid used to show.
 */
export async function toPublicUserOrDeleted<T extends RawUserIdentity>(
  u: T | null | undefined,
  externalName?: string | null,
): Promise<unknown> {
  if (u) return toPublicUser(u);
  return externalName ? null : DELETED_USER_VIEW;
}

/** Normalized public view of a user (with displayName and resolved avatarUrl). */
export async function toPublicUser<T extends RawUserIdentity>(
  u: T,
): Promise<T & { displayName: string; initials: string; avatarUrl: string | null }> {
  return {
    ...u,
    displayName: displayName(u),
    initials: initials(u),
    avatarUrl: await avatarUrl(u.avatarKey),
  };
}

/** Fields to select to build a public view: only what is strictly necessary. */
export const publicUserSelect = {
  select: {
    id: true,
    name: true,
    email: true,
    firstName: true,
    lastName: true,
    username: true,
    avatarKey: true,
  },
} as const;

/** Replaces the raw author of each row with its public view (avatar, displayName). */
export async function withPublicAuthors<T extends { createdBy: RawUserIdentity }>(rows: T[]) {
  return Promise.all(rows.map(async (r) => ({ ...r, createdBy: await toPublicUser(r.createdBy) })));
}

/**
 * View of the logged-in user, returned by all routes that open or replay a session
 * (`/api/auth/login`, `/api/auth/2fa/verify`, `/api/auth/me`).
 *
 * Each of these three routes copied the list of fields by hand, and none had added the enriched
 * profile (42.B №89): job title, bio and phone were indeed saved by `PATCH /api/users/me`, but the
 * first page reload called `/me` and cleared them from the store, so the form displayed them empty
 * again, as if the save had kept nothing. The view is therefore unique, and serves as the contract
 * for the front end's `AuthUser` type.
 */
export async function toSessionUser(u: RawSessionUser) {
  const view = await toPublicUser({
    id: u.id,
    email: u.email,
    name: u.name ?? null,
    firstName: u.firstName ?? null,
    lastName: u.lastName ?? null,
    username: u.username ?? null,
    avatarKey: u.avatarKey ?? null,
  });
  return {
    ...view,
    jobTitle: u.jobTitle ?? null,
    bio: u.bio ?? null,
    phone: u.phone ?? null,
    role: u.role,
    status: u.status,
  };
}

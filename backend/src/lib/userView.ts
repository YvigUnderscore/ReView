// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Role, UserStatus } from '@prisma/client';
import { storage } from '../services/StorageService';
import { imageTypeFromKey } from './uploadContentType';

/** Champs d'identité bruts d'un utilisateur, tels que sélectionnés en base. */
export interface RawUserIdentity {
  id: number;
  email: string;
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  username?: string | null;
  avatarKey?: string | null;
}

/** Identité + profil enrichi (42.B №89) + rôle : ce que voit l'utilisateur de sa session. */
export interface RawSessionUser extends RawUserIdentity {
  jobTitle?: string | null;
  bio?: string | null;
  phone?: string | null;
  role: Role;
  status?: UserStatus;
}

/** Nom d'affichage : pseudo > nom complet legacy > prénom+nom > email. */
export function displayName(u: RawUserIdentity): string {
  if (u.username) return u.username;
  if (u.name) return u.name;
  const full = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
  if (full) return full;
  return u.email;
}

/** Initiales (1–2 lettres) pour l'avatar de repli. */
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

/** URL d'avatar présignée (null si pas d'avatar uploadé → repli initiales côté front). */
export async function avatarUrl(avatarKey?: string | null): Promise<string | null> {
  if (!avatarKey) return null;
  try {
    // Type imposé d'après l'extension : l'avatar est déposé par PUT présigné, dont la
    // signature ne contraint pas le Content-Type envoyé. Un « avatar » en text/html
    // s'exécuterait sur l'origine de l'app au moment où quelqu'un ouvre l'URL.
    return await storage.getPresignedGetUrl(avatarKey, 3600, imageTypeFromKey(avatarKey));
  } catch {
    return null;
  }
}

/**
 * Vue d'un auteur dont le compte a été supprimé.
 *
 * La plupart des relations d'auteur sont en `SetNull` : supprimer un compte laisse derrière
 * lui des commentaires, décisions et marqueurs dont l'auteur vaut `null`. Les vues publiques
 * déréférençaient cet auteur sans précaution — un seul départ suffisait à casser en 500 tous
 * les fils de review où la personne était passée.
 */
export const DELETED_USER_VIEW = {
  id: null,
  displayName: 'Compte supprimé',
  initials: '—',
  avatarUrl: null,
} as const;

/**
 * Comme `toPublicUser`, mais tolère un auteur absent (compte supprimé).
 *
 * `externalName` distingue les deux façons de n'avoir pas de compte. Un compte supprimé
 * ne laisse rien derrière lui : c'est le cas que couvre `DELETED_USER_VIEW`. Un invité,
 * ou un intervenant qui a écrit depuis ShotGrid, n'a jamais eu de compte ici mais porte
 * son nom (`Comment.guestName`) : renvoyer `null` laisse alors l'affichage retomber sur
 * ce nom-là. Les confondre revient à présenter quelqu'un de bien vivant comme un compte
 * supprimé — c'est faux, et c'est ce que voyaient les retours venus de ShotGrid.
 */
export async function toPublicUserOrDeleted<T extends RawUserIdentity>(
  u: T | null | undefined,
  externalName?: string | null,
): Promise<unknown> {
  if (u) return toPublicUser(u);
  return externalName ? null : DELETED_USER_VIEW;
}

/** Vue publique normalisée d'un utilisateur (avec displayName + avatarUrl résolu). */
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

/** Champs à sélectionner pour construire une vue publique — le strict nécessaire. */
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

/** Remplace l'auteur brut de chaque ligne par sa vue publique (avatar, displayName). */
export async function withPublicAuthors<T extends { createdBy: RawUserIdentity }>(rows: T[]) {
  return Promise.all(rows.map(async (r) => ({ ...r, createdBy: await toPublicUser(r.createdBy) })));
}

/**
 * Vue de l'utilisateur connecté, renvoyée par toutes les routes qui ouvrent ou rejouent
 * une session (`/api/auth/login`, `/api/auth/2fa/verify`, `/api/auth/me`).
 *
 * Ces trois routes recopiaient chacune la liste des champs à la main, et aucune n'y avait
 * ajouté le profil enrichi (42.B №89) : poste, bio et téléphone étaient bien enregistrés
 * par `PATCH /api/users/me`, mais le premier rechargement de page rappelait `/me` et les
 * effaçait du store — le formulaire les réaffichait vides, comme si la sauvegarde n'avait
 * rien gardé. La vue est donc unique, et sert de contrat au type `AuthUser` du front.
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

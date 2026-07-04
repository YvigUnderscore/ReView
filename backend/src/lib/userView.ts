import { storage } from '../services/StorageService';

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
    return await storage.getPresignedGetUrl(avatarKey, 3600);
  } catch {
    return null;
  }
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

// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Formulaire de rétention : formes et bornes partagées avec `lib/retention` côté serveur.
 *
 * Le serveur assainit de toute façon ce qu'il reçoit ; ces bornes-ci existent pour que le
 * champ ne laisse jamais partir une valeur que l'API corrigerait en silence — l'admin
 * verrait alors autre chose que ce qu'il a tapé.
 */

export const RETENTION_FAMILIES = [
  'auditLog',
  'mediaAccessLog',
  'notification',
  'userSession',
  'passwordReset',
  'invitation',
  'shareLink',
  'shotgridSync',
  'apiEvent',
] as const;

export type RetentionFamily = (typeof RETENTION_FAMILIES)[number];

/** Durées en jours (`0` = conservation illimitée) + taille des tranches de suppression. */
export type RetentionPolicy = Record<RetentionFamily, number> & { batchSize: number };

/** Familles dont seules les lignes déjà mortes (expirées ou révoquées) sont supprimées. */
export const DEAD_ONLY_FAMILIES: ReadonlySet<RetentionFamily> = new Set<RetentionFamily>([
  'userSession',
  'passwordReset',
  'invitation',
  'shareLink',
]);

export const MAX_DAYS = 3650;
export const MIN_BATCH = 100;
export const MAX_BATCH = 20_000;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(Math.trunc(value), min), max);

/** Durée saisie → jours valides. Champ vidé ou illisible = `0`, soit « conserver ». */
export function clampDays(raw: string | number): number {
  const n = Number(raw);
  return Number.isFinite(n) ? clamp(n, 0, MAX_DAYS) : 0;
}

/** Taille de tranche saisie → valeur valide. Champ vidé = le plancher, jamais `0`. */
export function clampBatchSize(raw: string | number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return MIN_BATCH;
  return clamp(n, MIN_BATCH, MAX_BATCH);
}

// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Retention form: shapes and bounds shared with `lib/retention` on the server side.
 *
 * The server sanitises whatever it receives in any case; these bounds exist so that the
 * field never lets through a value the API would silently correct — the admin
 * would then see something other than what they typed.
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

/** Durations in days (`0` = unlimited retention) + size of the deletion batches. */
export type RetentionPolicy = Record<RetentionFamily, number> & { batchSize: number };

/** Families of which only already dead rows (expired or revoked) are deleted. */
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

/** Entered duration → valid days. Empty or unreadable field = `0`, i.e. "keep". */
export function clampDays(raw: string | number): number {
  const n = Number(raw);
  return Number.isFinite(n) ? clamp(n, 0, MAX_DAYS) : 0;
}

/** Entered batch size → valid value. Empty field = the floor, never `0`. */
export function clampBatchSize(raw: string | number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return MIN_BATCH;
  return clamp(n, MIN_BATCH, MAX_BATCH);
}

/**
 * Has the policy changed since loading?
 *
 * This is what arms the screen's save bar: without it the button stayed
 * permanently offered, and nothing distinguished "I have touched nothing" from "I have changed
 * something and not yet validated it".
 */
export function policyChanged(saved: RetentionPolicy, draft: RetentionPolicy): boolean {
  if (saved.batchSize !== draft.batchSize) return true;
  return RETENTION_FAMILIES.some((family) => saved[family] !== draft[family]);
}

// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/** Borne une taille dans [min, max]. Pur, testable. */
export function clampSize(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

const KEY_PREFIX = 'review.resizable.';

/** Lit une taille persistée (localStorage), repli si absente/invalide. */
export function readStoredSize(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + key);
    const n = raw == null ? NaN : Number(raw);
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

/** Persiste une taille (localStorage). */
export function writeStoredSize(key: string, value: number): void {
  try {
    localStorage.setItem(KEY_PREFIX + key, String(Math.round(value)));
  } catch {
    /* stockage indisponible : on ignore */
  }
}

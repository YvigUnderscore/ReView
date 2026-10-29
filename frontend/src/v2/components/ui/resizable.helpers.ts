// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/** Clamps a size to [min, max]. Pure, testable. */
export function clampSize(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

const KEY_PREFIX = 'review.resizable.';

/** Reads a persisted size (localStorage), falls back if absent or invalid. */
export function readStoredSize(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + key);
    const n = raw == null ? NaN : Number(raw);
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

/** Persists a size (localStorage). */
export function writeStoredSize(key: string, value: number): void {
  try {
    localStorage.setItem(KEY_PREFIX + key, String(Math.round(value)));
  } catch {
    /* storage unavailable: ignore */
  }
}

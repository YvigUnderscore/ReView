// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { intlLocale } from '../../i18n';

/**
 * Pure logic for the "drag-label" numeric field (`NumberField`): a value adjusted by
 * dragging horizontally on the label (DCC/Blender pattern), clamped and rounded to the step.
 * Testable without DOM. Written in Phase 17 for the HUD, promoted with the primitive during
 * the review chrome redesign — the maths did not change.
 */

export interface NumberFieldSpec {
  min: number;
  max: number;
  /** Rounding step of the value (e.g. 1 for whole degrees, 0.001 for an aperture). */
  step: number;
  /** Drag pixels to traverse one step (default 4: ~250 px for 60 steps). */
  pixelsPerStep?: number;
}

/** Rounds `value` to the nearest multiple of `step` (floating-point noise cleaned up). */
export function snapToStep(value: number, step: number): number {
  if (!(step > 0)) return value;
  const snapped = Math.round(value / step) * step;
  // Cleans binary noise (0.30000000000000004 → 0.3) according to the step's decimals.
  const decimals = Math.max(0, Math.ceil(-Math.log10(step)));
  return Number(snapped.toFixed(Math.min(decimals + 1, 10)));
}

/** Clamps then rounds a value according to the spec. */
export function clampValue(value: number, spec: NumberFieldSpec): number {
  return Math.min(spec.max, Math.max(spec.min, snapToStep(value, spec.step)));
}

/**
 * Value after dragging `dxPx` pixels from `start`: every `pixelsPerStep` pixels is one
 * `step` (Shift = ×10 via `fine=false`, Ctrl = fine step ×0.1 via `fine=true` on the caller's side).
 */
export function dragValue(start: number, dxPx: number, spec: NumberFieldSpec, multiplier = 1): number {
  const perStep = spec.pixelsPerStep ?? 4;
  const delta = (dxPx / perStep) * spec.step * multiplier;
  return clampValue(start + delta, spec);
}

/**
 * Distance (px) beyond which a press **on the input field** becomes a scrub rather than a
 * click. Short enough for the gesture to start clearly, long enough that a shaky click
 * still focuses the field.
 */
export const SCRUB_THRESHOLD_PX = 4;

/** True once the pointer has crossed the threshold: below it, the press remains a click. */
export function isScrub(dxPx: number): boolean {
  return Math.abs(dxPx) >= SCRUB_THRESHOLD_PX;
}

/**
 * Useful movement of a scrub armed on the field: the threshold is removed, otherwise the
 * value would jump several steps at the exact moment the gesture is recognised.
 */
export function scrubOffset(dxPx: number): number {
  return dxPx - Math.sign(dxPx) * SCRUB_THRESHOLD_PX;
}

/** Parses keyboard input (French decimal comma accepted) — null if empty or invalid. */
export function parseInput(text: string): number | null {
  const trimmed = text.trim().replace(',', '.');
  if (trimmed === '') return null;
  const v = Number(trimmed);
  return Number.isFinite(v) ? v : null;
}

/** Formats the value for display according to the step (no unnecessary decimals). */
export function formatValue(value: number, step: number): string {
  const decimals = step >= 1 ? 0 : Math.max(0, Math.ceil(-Math.log10(step)));
  return value.toLocaleString(intlLocale(), {
    // No thousands separator: `parseInput` reads back what is displayed, and cannot
    // undo grouping ("1 001" came back as NaN for a frame number).
    useGrouping: false,
    minimumFractionDigits: 0,
    maximumFractionDigits: Math.min(decimals, 6),
  });
}

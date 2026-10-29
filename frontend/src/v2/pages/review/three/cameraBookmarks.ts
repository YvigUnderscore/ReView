// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { t } from '@/v2/i18n';
import type { CameraBookmark, SplatCamera } from '../reviewTypes';

/** Maximum number of bookmarks, aligned with the keyboard shortcuts Alt+1 to Alt+9. */
export const MAX_BOOKMARKS = 9;

/** Physical keys of the view recall: digit row or numeric keypad. */
const DIGIT_CODE = /^(?:Digit|Numpad)([1-9])$/;

/**
 * Index of the bookmark targeted by a keystroke, or `null` if the keystroke does not concern it.
 *
 * Bare digits belong to the chrome's mode switch, in all four viewers: on a spatial media, `1`/`2`/`3`
 * recalled a view **and** changed mode, two responses for one keystroke. Recall therefore goes under
 * **Alt**, which frees the nine slots instead of the only 4-9 left by the switch.
 *
 * The key is read by its **position** (`code`) and not by the character produced: under Alt, `key`
 * holds the character of the layout (`&` on AZERTY, `¡` on macOS), never `1`.
 * Same choice as flight navigation (ZQSD = WASD).
 */
export function bookmarkShortcutIndex(
  e: Pick<KeyboardEvent, 'code' | 'altKey' | 'ctrlKey' | 'metaKey'>,
  count: number,
): number | null {
  if (!e.altKey || e.ctrlKey || e.metaKey) return null;
  const digit = DIGIT_CODE.exec(e.code)?.[1];
  if (!digit) return null;
  const index = Number(digit) - 1;
  return index < count ? index : null;
}

/**
 * Pure logic of the camera bookmarks (39.D), shared by the hook and tested in isolation.
 * Adds the current view with an automatic label ("View N"); returns `null` if the list is full
 * (the hook then shows an error, without mutation).
 */
export function appendBookmark(list: CameraBookmark[], camera: SplatCamera): CameraBookmark[] | null {
  if (list.length >= MAX_BOOKMARKS) return null;
  return [...list, { camera, label: t('camera.viewN', { n: list.length + 1 }) }];
}

/** Removes the bookmark at index `index` (out of bounds: list unchanged). */
export function removeBookmarkAt(list: CameraBookmark[], index: number): CameraBookmark[] {
  if (index < 0 || index >= list.length) return list;
  return list.filter((_, i) => i !== index);
}

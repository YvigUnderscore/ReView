// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Right-click policy in the application (A3).
 *
 * The browser's native menu has no place in a studio tool: it hides the content and offers nothing
 * useful. But replacing it everywhere with a generic menu was no better — the same menu opened on a
 * shot card, on a heading or on empty space, with entries unrelated to what was targeted.
 *
 * Rule adopted: **right click only makes sense on a target**. A component that has a domain menu
 * serves it (it consumes the event); everywhere else nothing happens, and the native menu stays
 * blocked. Three exceptions, in this order:
 *   1. the event has already been handled (Radix menu, 3D viewer that orbits) — we do not touch it;
 *   2. Shift+right click hands control back to the browser (Figma/Maps convention, troubleshooting);
 *   3. text inputs keep the native menu — otherwise pasting into a comment becomes painful, and the
 *      spell checker unreachable.
 */

/** Areas where the native menu remains king (text editing). */
export const NATIVE_ZONES =
  'input, textarea, select, [contenteditable="true"], [contenteditable="plaintext-only"]';

export interface ContextMenuSituation {
  /** A component has already served its own menu. */
  defaultPrevented: boolean;
  /** Shift held down: escape hatch to the browser's menu. */
  shiftKey: boolean;
  /** The target is an input field or an editable area. */
  inNativeZone: boolean;
}

/** Should the browser's native menu be prevented from opening? */
export function shouldBlockNativeMenu({
  defaultPrevented,
  shiftKey,
  inNativeZone,
}: ContextMenuSituation): boolean {
  if (defaultPrevented) return false;
  if (shiftKey) return false;
  if (inNativeZone) return false;
  return true;
}

/** Reads the situation from a real event. */
export function situationOf(event: MouseEvent): ContextMenuSituation {
  const target = event.target as Element | null;
  return {
    defaultPrevented: event.defaultPrevented,
    shiftKey: event.shiftKey,
    inNativeZone: Boolean(target?.closest?.(NATIVE_ZONES)),
  };
}

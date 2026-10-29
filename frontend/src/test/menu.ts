// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { fireEvent, screen } from '@testing-library/react';

/**
 * Context menus (Radix) in tests.
 *
 * The application puts its actions on right click ("simple UI" rule): tests must therefore
 * know how to reach them. Two traps, both paid for once here rather than in each
 * file:
 *
 * 1. **`fireEvent.click`, not `userEvent.click`.** `userEvent` moves the pointer before
 *    clicking; under happy-dom, that move takes the cursor off the submenu trigger, Radix
 *    closes the submenu, and the click falls into the void, silently,
 *    since the element still exists in the DOM at search time.
 * 2. The content of a submenu only exists once the submenu is open: one must click
 *    the trigger before looking for its entries.
 */

/** Opens the context menu attached to an element (right click). */
export function openContextMenu(target: Element): void {
  fireEvent.contextMenu(target);
}

/** Expands a submenu by its label and makes its content reachable. */
export async function openSubmenu(label: string | RegExp): Promise<void> {
  fireEvent.click(await screen.findByRole('menuitem', { name: label }));
}

/** Triggers a simple menu entry. */
export async function clickMenuItem(label: string | RegExp): Promise<void> {
  fireEvent.click(await screen.findByRole('menuitem', { name: label }));
}

/** Ticks an entry of a radio group (status, sort, display mode). */
export async function clickMenuRadio(label: string | RegExp): Promise<void> {
  fireEvent.click(await screen.findByRole('menuitemradio', { name: label }));
}

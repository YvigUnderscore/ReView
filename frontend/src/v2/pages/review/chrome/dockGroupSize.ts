// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * From how many entries a collapsible dock group arrives **collapsed**.
 *
 * No dock group used to be collapsible: the Info panel of a rich USD scene — spec sheet, USD
 * scene, one line per texture — had to be scrolled, and the measures of the current frame, which
 * fit in four lines, fell out of view. The threshold is set at the dock's usable height: below it,
 * everything reads at a glance and collapsing would cost a click for nothing; above it, the group
 * shows up closed, with its count.
 *
 * Kept in its own file rather than beside `Group`: the dock only exports components, and one more
 * function there would break hot reloading (`react-refresh`).
 */
export const DOCK_GROUP_COLLAPSE_THRESHOLD = 6;

/** Is this group long enough to arrive collapsed? */
export function isLongDockGroup(count: number): boolean {
  return count > DOCK_GROUP_COLLAPSE_THRESHOLD;
}

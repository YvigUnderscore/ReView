// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { ApiError } from '../../lib/apiClient';

/**
 * The two questions a page for an entity asks itself before rendering: "does my subject exist?" and
 * "does the identifier in the URL even mean anything?".
 *
 * They live in their own file rather than beside the component: a module exporting both a component and functions
 * breaks Vite's hot reload.
 */

/** Does the error say the entity is absent (404) or locked (403)? */
export function isMissingOrForbidden(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 404 || error.status === 403);
}

/** An unusable URL identifier (`/tasks/abc`) counts as an absent entity. */
export function isBadId(id: number): boolean {
  return !Number.isFinite(id) || id <= 0;
}

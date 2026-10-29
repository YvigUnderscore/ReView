// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Decides "what to show in place of the content" for a TanStack query.
 *
 * Admin screens all shared the same shape — `if (!data) return <SkeletonRows />` — which
 * conflates two situations the operator must tell apart: the data is arriving, or the server
 * answered 500. In the second case the skeleton pulsed forever, with no message and no way
 * to retry other than F5.
 *
 * The decision is isolated here, outside React, so it can be tested: the `QueryState`
 * component now only paints the chosen phase.
 */

/** What a screen displays in place of its content. */
export type QueryPhase = 'pending' | 'error' | 'ready';

/** The only signals read from a query — two booleans, both provided by TanStack. */
export interface QuerySnapshot {
  /** The last attempt failed (`status === 'error'`). */
  isError: boolean;
  /** Usable data is at hand (fresh response, cache, previous page). */
  hasData: boolean;
}

/**
 * Priority order:
 *
 * 1. **Data at hand → `ready`.** A failed refresh does not wipe a screen already filled:
 *    the operator keeps the content, even if it ages. This is what makes the primitive safe
 *    on paginated lists (`keepPreviousData`).
 * 2. **Failure without data → `error`.** Nothing to show: the screen says so and offers a retry.
 * 3. **Everything else → `pending`.** Initial load, but also a disabled query
 *    (`enabled: false`) or a success without a body — we fall back to the skeleton, which was
 *    already the existing behaviour.
 *
 * `isFetching` is deliberately absent: letting it take precedence over failure would make
 * the skeleton and error panel flicker every five seconds on screens that poll
 * (`refetchInterval`, see the jobs page). The panel therefore stays displayed during the
 * retry, and disappears when it succeeds.
 */
export function resolveQueryPhase({ isError, hasData }: QuerySnapshot): QueryPhase {
  if (hasData) return 'ready';
  return isError ? 'error' : 'pending';
}

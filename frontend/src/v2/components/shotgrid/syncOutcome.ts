// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the panel announces when a sync request returns: pure logic.
 *
 * The server distinguishes three outcomes where the screen only read two. A request that
 * arrives while a pass is running returns `deferred`: it is merged with the pending
 * request and replayed at the end of the current pass, but nothing has happened yet.
 * Announcing it in green as "Sync complete" sends the user looking in the run list for a
 * result that is not there, which is exactly the confusion the `deferred` status exists to remove.
 */

/** Green is reserved for work actually done; queueing is announced in neutral. */
export type SyncTone = 'success' | 'info' | 'error';

export interface SyncOutcome {
  tone: SyncTone;
  key: 'shotgrid.sync.done' | 'shotgrid.sync.failed' | 'shotgrid.sync.queued';
}

/**
 * Status returned by the API → banner to display. An unknown status falls back to "done":
 * the pass did take place, only its detail escapes us.
 */
export function syncOutcome(status: string | undefined): SyncOutcome {
  if (status === 'error') return { tone: 'error', key: 'shotgrid.sync.failed' };
  if (status === 'deferred') return { tone: 'info', key: 'shotgrid.sync.queued' };
  return { tone: 'success', key: 'shotgrid.sync.done' };
}

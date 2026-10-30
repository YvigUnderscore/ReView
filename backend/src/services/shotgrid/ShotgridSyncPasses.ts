// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Which passes to run, and on which entities.
 *
 * A ShotGrid synchronization is a sequence of passes (status reference, accounts,
 * sequences, shots, assets, tasks, versions, publishes, notes, playlists). Triggering
 * all of them every time had two opposite consequences, both wrong:
 *
 * - an event concerning ONE version replayed the whole project — thousands of requests
 *   for an entity that had moved;
 * - a Note or Playlist event triggered NOTHING, because the only available switch
 *   (`withMedia`) was `entity === 'Version'`, hence false. The outbound direction
 *   worked, the inbound one was dead.
 *
 * This module decides: each event type gets its own list of passes, and nothing else.
 * It is deliberately pure — no database, no client — so that it can be verified on its own.
 */

export type SyncPass =
  | 'statuses'
  | 'users'
  | 'episodes'
  | 'sequences'
  | 'shots'
  | 'assets'
  | 'tasks'
  | 'versions'
  | 'publishedFiles'
  | 'notes'
  | 'playlists';

export const ALL_PASSES: readonly SyncPass[] = [
  'statuses',
  'users',
  // Before the sequences: the attachment reads the episodes' match.
  'episodes',
  'sequences',
  'shots',
  'assets',
  'tasks',
  'versions',
  'publishedFiles',
  'notes',
  'playlists',
];

/**
 * "Structure only" pass: what `withMedia: false` historically requested.
 * Notes and playlists are excluded because they rely on versions.
 */
export const STRUCTURE_PASSES: readonly SyncPass[] = [
  'statuses',
  'users',
  'episodes',
  'sequences',
  'shots',
  'assets',
  'tasks',
];

/**
 * Passes triggered by each type of event from the site.
 *
 * The status reference accompanies any pass that reads a `sg_status_list`: without it, `statusPatch` recognises no code and the journal fills with "unknown status".
 * Assets carry none on the ReView side, so they do without it.
 */
const PASSES_BY_ENTITY: Readonly<Record<string, readonly SyncPass[]>> = {
  // A sequence may have changed episode: the "episodes" pass accompanies it. On a project without the level, it does nothing at all.
  Sequence: ['statuses', 'episodes', 'sequences'],
  Episode: ['statuses', 'episodes'],
  Shot: ['statuses', 'shots'],
  Asset: ['assets'],
  Task: ['statuses', 'users', 'tasks'],
  Version: ['versions'],
  Note: ['notes'],
  Playlist: ['playlists'],
  // A renamed or removed status touches the whole hierarchy: it is re-read in full, but without the media, which cannot have changed.
  Status: ['statuses', 'episodes', 'sequences', 'shots', 'assets', 'tasks'],
  // A modified account changes the assignments: only tasks carry them.
  HumanUser: ['statuses', 'users', 'tasks'],
};

/**
 * Entities whose event concerns the whole project rather than a precise line: targeting them by identifier would make no sense (a status is not a production entity;
 * it qualifies thousands of them).
 */
const GLOBAL_ENTITIES = new Set(['Status', 'HumanUser']);

/**
 * Entities ReView knows how to handle — the rest is ignored silently. The list is deduced from the passes table: accepting an event that no pass handles was
 * exactly the default of notes and playlists.
 */
export const HANDLED_ENTITIES: ReadonlySet<string> = new Set(Object.keys(PASSES_BY_ENTITY));

export function passesForEvent(entity: string): readonly SyncPass[] | null {
  return PASSES_BY_ENTITY[entity] ?? null;
}

export function eventIsGlobal(entity: string): boolean {
  return GLOBAL_ENTITIES.has(entity);
}

/**
 * Passes deduced from a targeted request that did not name them.
 *
 * Realigning a shot's card or arbitrating a task conflict passes `onlySgIds` without saying anything about the passes: the request then swept the notes, the playlists
 * and the project's five thousand `PublishedFile` for a single entity. The targeted type is enough to know what to re-read.
 * An unknown type cannot be guessed: we return `undefined` and everything runs.
 */
export function impliedPasses(
  onlySgIds: readonly { sgType: string; sgId: number }[] | undefined,
): SyncPass[] | undefined {
  if (!onlySgIds?.length) return undefined;
  const union = new Set<SyncPass>();
  for (const { sgType } of onlySgIds) {
    const passes = passesForEvent(sgType);
    if (!passes) return undefined;
    for (const pass of passes) union.add(pass);
  }
  return ALL_PASSES.filter((p) => union.has(p));
}

/**
 * Passes actually requested.
 *
 * An explicit `passes` takes precedence, then the deduction from the targeted entities, then everything. `withMedia: false` remains a veto: it removes versions, publishes,
 * notes and playlists however the list was obtained — a caller who said "structure only" must not end up fetching media by deduction.
 */
export function resolvePasses(options: {
  passes?: readonly SyncPass[];
  onlySgIds?: readonly { sgType: string; sgId: number }[];
  withMedia?: boolean;
}): Set<SyncPass> {
  const list = options.passes ?? impliedPasses(options.onlySgIds) ?? ALL_PASSES;
  if (options.withMedia === false) return new Set(list.filter((p) => STRUCTURE_PASSES.includes(p)));
  return new Set(list);
}

/**
 * Merge of two requests: the union, and `undefined` (= everything) absorbs the rest.
 * As with `onlySgIds`, one may over-catch, never under-catch.
 */
export function mergePasses(
  a: readonly SyncPass[] | undefined,
  b: readonly SyncPass[] | undefined,
): SyncPass[] | undefined {
  if (!a || !b) return undefined;
  const union = new Set<SyncPass>([...a, ...b]);
  // Canonical order: the list also serves as a readable trace in the journal.
  return ALL_PASSES.filter((p) => union.has(p));
}

/** Remote identifiers of a given type in a targeted request. */
export function sgIdsOfType(
  onlySgIds: readonly { sgType: string; sgId: number }[] | undefined,
  sgType: string,
): number[] {
  if (!onlySgIds?.length) return [];
  const ids = onlySgIds.filter((r) => r.sgType === sgType).map((r) => r.sgId);
  return [...new Set(ids)];
}

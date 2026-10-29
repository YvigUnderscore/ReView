// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Shot } from '../../types/api';

/**
 * Attaching shots to the sequence being viewed: what the list offers, and what the gesture will
 * actually do.
 *
 * A shot only carries one sequence (`sequenceId`): "attaching" therefore adds nothing, it
 * **moves**. The nuance depends on the origin — a shot outside any sequence joins without anyone
 * losing it, a shot taken from SQ020 leaves it. The separation is made here, in data, so that the
 * screen states it instead of leaving it to be guessed.
 */

/** What attaching needs from a shot (the project list carries far more). */
export type AttachableShot = Pick<Shot, 'id' | 'code' | 'name' | 'sequenceId'> & {
  thumbnailUrl?: string | null;
};

/** The two possible origins, never mixed on screen. */
export interface AttachGroups<T extends AttachableShot> {
  /** Shots no sequence claims: attaching them takes nothing from anyone. */
  free: T[];
  /** Shots already filed elsewhere: attaching them removes them from their current sequence. */
  elsewhere: T[];
}

const byCode = (a: AttachableShot, b: AttachableShot) =>
  a.code.localeCompare(b.code, undefined, { numeric: true });

/**
 * Shots that can be attached, grouped by origin.
 *
 * Those **already in the sequence** are excluded: offering them would suggest a gesture is still
 * left to make, and ticking them would have no effect. The search matches the code and the name,
 * case-insensitively.
 */
export function attachableShots<T extends AttachableShot>(
  shots: T[],
  sequenceId: number,
  query = '',
): AttachGroups<T> {
  const needle = query.trim().toLocaleLowerCase();
  const candidates = shots.filter((shot) => {
    if (shot.sequenceId === sequenceId) return false;
    if (!needle) return true;
    return `${shot.code} ${shot.name}`.toLocaleLowerCase().includes(needle);
  });
  return {
    free: candidates.filter((s) => s.sequenceId === null).sort(byCode),
    elsewhere: candidates.filter((s) => s.sequenceId !== null).sort(byCode),
  };
}

/**
 * How many selected shots would leave another sequence.
 *
 * It is the only figure that deserves a warning: attaching a free shot has no consequence, taking
 * it from another sequence undoes that sequence's assembly.
 */
export function movedFromOtherSequence(shots: AttachableShot[], picked: Set<number>): number {
  return shots.filter((s) => picked.has(s.id) && s.sequenceId !== null).length;
}

/** What prevents submitting — `null` when the gesture can go ahead. */
export type AttachRefusal = 'forbidden' | 'empty';

/**
 * Guard for attaching, before the network call.
 *
 * The server already refuses a non-manager (403), but the screen must not let the user build an
 * entire selection only to learn that on the last click.
 */
export function attachRefusal(canManage: boolean, pickedCount: number): AttachRefusal | null {
  if (!canManage) return 'forbidden';
  if (pickedCount === 0) return 'empty';
  return null;
}

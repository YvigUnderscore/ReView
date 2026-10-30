// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Omitting a shot from the mount — pure logic, no React and no network.
 *
 * The flag existed in the database and in automatic mounts (Phase 45), written by the sole route
 * `PATCH /api/shots/:id`: production could *see* that a shot was cut — the sequence grid marks it
 * with a crossed-out eye — without ever being able to decide it.
 *
 * This module says what the flag is worth, which body toggles it, and which sequence to refresh.
 */

/**
 * The shot as the screen has it at hand. A project list provides it flat (`sequenceId`), a shot
 * record nests it (`sequence`): the two caches do not have the same shape, and knowing only one would
 * leave the crossed-out eye stale on the other screen.
 */
export interface OmitTarget {
  id: number;
  omitted?: boolean;
  sequenceId?: number | null;
  sequence?: { id: number } | null;
}

/** A shot without a flag is in the mount: the absence of a value is not an omission. */
export function isOmitted(shot: OmitTarget): boolean {
  return shot.omitted === true;
}

/**
 * The body of the `PATCH`: the toggle, and nothing else.
 *
 * The shot remains editable elsewhere — settings panel, status on right click, ShotGrid sync.
 * Attaching any field that nobody touched would republish to the site a value that may have moved
 * in the meantime, and overwrite it on the way.
 */
export function omitBody(shot: OmitTarget): { omitted: boolean } {
  return { omitted: !isOmitted(shot) };
}

/** The owning sequence, whatever the shape received — `null` for a shot without a sequence. */
export function sequenceIdOf(shot: OmitTarget): number | null {
  return shot.sequenceId ?? shot.sequence?.id ?? null;
}

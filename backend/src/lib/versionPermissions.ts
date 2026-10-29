// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the caller is allowed to write on a version, **computed server-side** and returned with the
 * media detail (`permissions`), so the screen no longer has to guess it.
 *
 * Reason: the front end alone decided to show the gizmos and the "Save" button based on the rule
 * "unpublished version + internal role". The server, however, requires **the author of the version
 * or a project manager** (`VersionService.update`) on top of the publication lock
 * (`assertWritable(version, 'versionTransform')`). An ARTIST who was a project member but not the
 * author therefore saw a button that the server then refused with a 403: a dead button, which the
 * project explicitly forbids.
 *
 * The two guards of the service stay in place and keep their distinct messages (a 403 with the
 * production message "auteur ou superviseur" on one side, `PUBLISHED_LOCKED` on the other): this
 * predicate is their **conjunction**, the one that decides whether the action is offered. Any change
 * to either guard must be reflected here: this is the only place that answers for it to the interface.
 */

/** What needs to be known about a version to decide on editing its transform. */
export interface VersionTransformSubject {
  authorId: number | null;
  published: boolean;
}

/**
 * Is this version's TRS transform editable by this caller?
 *
 * `manager` is the **effective role on the project** (`isProjectManager`), not the global role:
 * a supervisor named on the project counts, a global ADMIN too, a non-author artist does not.
 */
export function canEditVersionTransform(
  version: VersionTransformSubject,
  userId: number,
  manager: boolean,
): boolean {
  if (version.published) return false;
  return manager || version.authorId === userId;
}

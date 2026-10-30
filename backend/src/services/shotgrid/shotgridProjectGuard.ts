// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { asEntityRef, type SgRecord } from './shotgridMapper';

/**
 * Project scope guard.
 *
 * A ShotGrid site hosts all the studio's projects. A badly filtered query, an identifier reused after deletion, a webhook misconfigured on the ShotGrid side:
 * it takes little to read — or worse, write — into the neighbour's project. Every incoming datum therefore goes through `belongsToProject`, and every outgoing query
 * through `projectFilter`. The belt (the filter) and the braces (the check): the filter can be forgotten in one call, the check is the last line of defence.
 *
 * Entities outside any project (HumanUser, Status, Step) have no `project` field: they are explicitly listed here, rather than accepting any entity without a project.
 */

/** Global entities of a site, legitimately without a project attachment. */
export const PROJECT_LESS_ENTITIES = new Set([
  'HumanUser',
  'ApiUser',
  'Status',
  'Step',
  'PublishedFileType',
  'Department',
  'Group',
]);

export interface ProjectScope {
  sgProjectId: number;
  sgProjectName: string;
}

/** Filter to attach to any search on a project entity. */
export function projectFilter(sgProjectId: number): [string, string, { type: string; id: number }] {
  return ['project', 'is', { type: 'Project', id: sgProjectId }];
}

export type BelongsResult =
  { ok: true } | { ok: false; reason: 'wrong_project'; foundProjectId: number | null };

/**
 * Does the entity indeed belong to the linked project? A known global entity passes;
 * a project entity without a readable `project` field is refused (we do not guess).
 */
export function belongsToProject(record: SgRecord, scope: ProjectScope): BelongsResult {
  if (PROJECT_LESS_ENTITIES.has(record.type)) return { ok: true };
  // The project itself: it is its own identifier that must match.
  if (record.type === 'Project')
    return record.id === scope.sgProjectId
      ? { ok: true }
      : { ok: false, reason: 'wrong_project', foundProjectId: record.id };

  const ref = asEntityRef(record.project);
  if (!ref) return { ok: false, reason: 'wrong_project', foundProjectId: null };
  return ref.id === scope.sgProjectId
    ? { ok: true }
    : { ok: false, reason: 'wrong_project', foundProjectId: ref.id };
}

/**
 * Is the remote project still the one we think it is?
 *
 * Checked before each synchronization: if the name no longer matches, we do not know whether the project has merely been renamed or whether the identifier now designates
 * something else. In doubt we stop — writing into the wrong project cannot be undone. The comparison ignores case and edge spaces, not the rest.
 */
export function projectNameMatches(remoteName: string | null | undefined, expected: string): boolean {
  if (typeof remoteName !== 'string') return false;
  return remoteName.trim().toLocaleLowerCase() === expected.trim().toLocaleLowerCase();
}

/** Webhook event: does it indeed concern this connection's project? */
export function eventBelongsToProject(
  payload: { project?: unknown; entity?: unknown },
  scope: ProjectScope,
): boolean {
  const ref = asEntityRef(payload.project);
  if (ref) return ref.id === scope.sgProjectId;
  // Without a project in the envelope, the entity may be global (Status, HumanUser).
  const entity = asEntityRef(payload.entity);
  return entity !== null && PROJECT_LESS_ENTITIES.has(entity.type);
}

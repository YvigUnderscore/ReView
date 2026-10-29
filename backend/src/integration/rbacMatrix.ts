// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Actor, RbacFixture } from './rbacFixture';

/**
 * Authorization matrix: declarative table of `[method, path, role, expected]` rows.
 *
 * This file is meant to grow. Adding an endpoint means adding a row; the engine
 * (`rbac-matrix.itest.ts`) takes care of the rest, including replaying each row without a token
 * to require a 401. Three rules keep the table readable:
 *
 *  1. **`allow` does not mean "200"**, it means "the guard let it through" (< 400). That is all an
 *     authorization test should assert; the rest belongs to functional tests.
 *  2. **`deny` means exactly 403.** A "polite" 404 instead of a 403 would be a different decision:
 *     defensible, but it must be written here, not discovered.
 *  3. **A row that writes must be replayable.** The mutating cases kept are idempotent (adding a
 *     member is an upsert, writing an empty board); otherwise, declare only the denied side and
 *     leave the allowed actors out of the row.
 */

/** Expected verdict of the guard, regardless of what the handler does afterwards. */
export type Outcome = 'allow' | 'deny';

export interface MatrixCase {
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  /** Path with substitutions `{projectA}`, `{shotB}`, `{userArtist}`... (see `substitute`). */
  path: string;
  /** Body sent as-is; substitutions also apply to numeric values. */
  body?: Record<string, unknown>;
  /** Reminder of the guard covered: serves as the failure message, so it is written to be read. */
  guard: string;
  /**
   * Expected verdict per actor. **An absent actor is not played**: this is how destructive
   * combinations (purging a project as admin) are kept out of reach.
   */
  expect: Partial<Record<Exclude<Actor, 'anon'>, Outcome>>;
  /** Public endpoint: do not require a 401 from the anonymous actor. */
  public?: boolean;
}

/** All substitutions recognised in a path or a body. */
export function placeholders(f: RbacFixture): Record<string, number> {
  return {
    projectA: f.projectA,
    projectB: f.projectB,
    shotA: f.shotA,
    shotB: f.shotB,
    taskB: f.taskB,
    versionB: f.versionB,
    userArtist: f.userIds.artist,
    userClient: f.userIds.client,
    userOutsider: f.userIds.outsider,
  };
}

export function substitute(path: string, values: Record<string, number>): string {
  return path.replace(/\{(\w+)\}/g, (_m, key: string) => {
    const value = values[key];
    if (value === undefined) throw new Error(`Unknown placeholder {${key}} in "${path}"`);
    return String(value);
  });
}

/** Same substitution inside a JSON body: `{ userId: '{userArtist}' }` becomes `{ userId: 42 }`. */
export function substituteBody(
  body: Record<string, unknown> | undefined,
  values: Record<string, number>,
): Record<string, unknown> | undefined {
  if (!body) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    out[key] =
      typeof value === 'string' && /^\{\w+\}$/.test(value) ? Number(substitute(value, values)) : value;
  }
  return out;
}

const EMPTY_BOARD = { document: { elements: [], files: {} }, baseUpdatedAt: null };

/**
 * The table.
 *
 * It covers the four families of guards in the backend: `requireRole` (global),
 * `requireProjectAccess` / `assertProjectAccess` (membership), `requireProjectManage`
 * (local elevation, decision 38.E) and the refusals specific to the CLIENT role.
 */
export const AUTHORIZATION_MATRIX: MatrixCase[] = [
  // ── requireProjectAccess: project membership ──
  {
    method: 'get',
    path: '/api/projects/{projectA}',
    guard: 'requireProjectAccess',
    expect: { admin: 'allow', supervisor: 'allow', artist: 'allow', client: 'allow', outsider: 'deny' },
  },
  {
    method: 'get',
    path: '/api/projects/{projectB}',
    guard: 'requireProjectAccess (projet disjoint)',
    expect: { admin: 'allow', supervisor: 'allow', artist: 'deny', client: 'deny', outsider: 'allow' },
  },
  {
    method: 'get',
    path: '/api/projects/{projectB}/settings',
    guard: 'requireProjectAccess',
    expect: { admin: 'allow', supervisor: 'allow', artist: 'deny', client: 'deny', outsider: 'allow' },
  },
  {
    method: 'get',
    path: '/api/projects/{projectB}/activity',
    guard: 'requireProjectAccess',
    expect: { admin: 'allow', supervisor: 'allow', artist: 'deny', client: 'deny', outsider: 'allow' },
  },

  // ── assertProjectAccess: the same check, but inside the handler ──
  {
    method: 'get',
    path: '/api/shots?projectId={projectA}',
    guard: 'assertProjectAccess (liste)',
    expect: { admin: 'allow', supervisor: 'allow', artist: 'allow', client: 'allow', outsider: 'deny' },
  },
  {
    method: 'get',
    path: '/api/shots?projectId={projectB}',
    guard: 'assertProjectAccess (liste, projet disjoint)',
    expect: { admin: 'allow', supervisor: 'allow', artist: 'deny', client: 'deny', outsider: 'allow' },
  },
  {
    method: 'get',
    path: '/api/sequences?projectId={projectB}',
    guard: 'assertProjectAccess (liste)',
    expect: { admin: 'allow', supervisor: 'allow', artist: 'deny', client: 'deny', outsider: 'allow' },
  },
  {
    method: 'get',
    path: '/api/assets?projectId={projectB}',
    guard: 'assertProjectAccess (liste)',
    expect: { admin: 'allow', supervisor: 'allow', artist: 'deny', client: 'deny', outsider: 'allow' },
  },
  {
    method: 'get',
    path: '/api/tasks?projectId={projectB}',
    guard: 'assertProjectAccess (liste)',
    expect: { admin: 'allow', supervisor: 'allow', artist: 'deny', client: 'deny', outsider: 'allow' },
  },
  // Access by identifier: the project is not in the URL, it is resolved from the entity.
  // This is exactly the IDOR shape that no test with a mocked Prisma can see.
  {
    method: 'get',
    path: '/api/shots/{shotB}',
    guard: 'assertProjectAccess (par id, IDOR)',
    expect: { admin: 'allow', supervisor: 'allow', artist: 'deny', client: 'deny', outsider: 'allow' },
  },
  {
    method: 'get',
    path: '/api/shots/{shotB}/tree',
    guard: 'assertProjectAccess (par id, IDOR)',
    expect: { admin: 'allow', supervisor: 'allow', artist: 'deny', client: 'deny', outsider: 'allow' },
  },
  {
    method: 'get',
    path: '/api/tasks/{taskB}',
    guard: 'assertProjectAccess (par id, IDOR)',
    expect: { admin: 'allow', supervisor: 'allow', artist: 'deny', client: 'deny', outsider: 'allow' },
  },
  {
    method: 'get',
    path: '/api/versions/{versionB}',
    guard: 'assertProjectAccess (par id, IDOR)',
    expect: { admin: 'allow', supervisor: 'allow', artist: 'deny', client: 'deny', outsider: 'allow' },
  },

  // ── requireRole: global privileges ──
  {
    method: 'get',
    path: '/api/users',
    guard: 'requireRole(ADMIN, SUPERVISOR)',
    expect: { admin: 'allow', supervisor: 'allow', artist: 'deny', client: 'deny', outsider: 'deny' },
  },
  {
    method: 'get',
    path: '/api/projects/{projectA}/trash',
    guard: 'requireRole(ADMIN, SUPERVISOR)',
    expect: { admin: 'allow', supervisor: 'allow', artist: 'deny', client: 'deny', outsider: 'deny' },
  },
  {
    method: 'get',
    path: '/api/studio/settings',
    guard: 'requireRole(ADMIN)',
    expect: { admin: 'allow', supervisor: 'deny', artist: 'deny', client: 'deny', outsider: 'deny' },
  },
  {
    method: 'get',
    path: '/api/studio/audit',
    guard: 'requireRole(ADMIN)',
    expect: { admin: 'allow', supervisor: 'deny', artist: 'deny', client: 'deny', outsider: 'deny' },
  },
  {
    method: 'get',
    path: '/api/admin/webhooks',
    guard: 'requireRole(ADMIN)',
    expect: { admin: 'allow', supervisor: 'deny', artist: 'deny', client: 'deny', outsider: 'deny' },
  },
  {
    method: 'get',
    path: '/api/admin/service-tokens',
    guard: 'requireRole(ADMIN)',
    expect: { admin: 'allow', supervisor: 'deny', artist: 'deny', client: 'deny', outsider: 'deny' },
  },
  // Writes: only the denied side is played. Creating a project or an account on every run would
  // pollute the matrix's own fixture.
  {
    method: 'post',
    path: '/api/projects',
    body: { name: 'RBAC forbidden' },
    guard: 'requireRole(ADMIN, SUPERVISOR)',
    expect: { artist: 'deny', client: 'deny', outsider: 'deny' },
  },
  {
    method: 'post',
    path: '/api/users',
    body: { email: 'rbac-forbidden@review.local', role: 'ARTIST' },
    guard: 'requireRole(ADMIN)',
    expect: { supervisor: 'deny', artist: 'deny', client: 'deny', outsider: 'deny' },
  },
  // Purge: destructive. The admin is deliberately not played.
  {
    method: 'delete',
    path: '/api/projects/{projectB}/purge',
    guard: 'requireRole(ADMIN)',
    expect: { supervisor: 'deny', artist: 'deny', client: 'deny', outsider: 'deny' },
  },

  // ── requireProjectManage: project management (38.E) ──
  // Idempotent: `addMember` is an upsert, and the artist is already a member of project A.
  {
    method: 'post',
    path: '/api/projects/{projectA}/members',
    body: { userId: '{userArtist}' },
    guard: 'requireProjectManage',
    expect: { admin: 'allow', supervisor: 'allow', artist: 'deny', client: 'deny', outsider: 'deny' },
  },

  // ── CLIENT role: project member, but never a contributor ──
  {
    method: 'get',
    path: '/api/boards/project/{projectA}',
    guard: 'assertProjectAccess (lecture board)',
    expect: { admin: 'allow', supervisor: 'allow', artist: 'allow', client: 'allow', outsider: 'deny' },
  },
  {
    method: 'put',
    path: '/api/boards/project/{projectA}',
    body: EMPTY_BOARD,
    guard: 'board en écriture : lecture seule pour un CLIENT',
    expect: { client: 'deny', outsider: 'deny' },
  },
];

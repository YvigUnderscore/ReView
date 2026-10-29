// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/prisma', () => ({
  prisma: {
    project: { count: vi.fn() },
    projectMembership: { findUnique: vi.fn() },
  },
}));

import type { Request, Response, NextFunction } from 'express';
import { Role } from '@prisma/client';
import { AppError } from '../lib/errors';
import { prisma } from '../lib/prisma';
import {
  resolveProjectAccess,
  checkProjectAccess,
  assertProjectAccess,
  requireProjectAccess,
  requireProjectManage,
} from './rbac';

/**
 * Project membership guard.
 *
 * The defect covered here: the guard only looked at `ProjectMembership`, never at `Project.deletedAt`.
 * Lists did filter trashed projects, but DIRECT URL access to a media, a shot, a sequence or an asset of
 * a removed project remained open, including to an ADMIN, whose access is global. Removal could thus be
 * bypassed by knowing the URL, and the list/URL inconsistency made the fault invisible in use.
 *
 * The Prisma double is reduced to what the guard queries: `project.count` (is the project addressable?)
 * and `projectMembership.findUnique` (is the person a member of it?).
 */

const projectCount = vi.mocked(prisma.project.count);
const membership = vi.mocked(prisma.projectMembership.findUnique);

/** Project 7 exists and is not in the trash. */
const liveProject = () => projectCount.mockResolvedValue(1);
/** Project 7 is in the trash: `count` only sees it with `includeTrashed`. */
const trashedProject = () =>
  projectCount.mockImplementation(
    (args: unknown) =>
      Promise.resolve((args as { where: { deletedAt?: unknown } }).where.deletedAt === null ? 0 : 1) as never,
  );
/** Project 7 never existed. */
const missingProject = () => projectCount.mockResolvedValue(0);

/** Member of project 7, without a local role: their global role applies as is. */
const member = () => membership.mockResolvedValue({ userId: 3, projectId: 7, role: null } as never);
/** Member of project 7 WITH a local role: elevation (38.E) or demotion. */
const memberAs = (role: Role) => membership.mockResolvedValue({ userId: 3, projectId: 7, role } as never);
const notMember = () => membership.mockResolvedValue(null);

const requestOf = (role: Role, params: Record<string, string> = { projectId: '7' }): Request =>
  ({ user: { id: 3, email: 'a@studio.com', role }, params }) as unknown as Request;

/** Runs a middleware and returns what it passed to `next` (an error, or nothing). */
const run = async (
  middleware: (req: Request, res: Response, next: NextFunction) => Promise<void>,
  req: Request,
): Promise<{ err: unknown; status: number | undefined }> => {
  const next = vi.fn();
  let status: number | undefined;
  const res = {
    status: (code: number) => {
      status = code;
      return { json: () => undefined };
    },
  } as unknown as Response;
  await middleware(req, res, next);
  return { err: next.mock.calls[0]?.[0] as unknown, status };
};

const statusOf = (err: unknown): number | undefined => (err instanceof AppError ? err.statusCode : undefined);

beforeEach(() => {
  vi.clearAllMocks();
  liveProject();
  notMember();
});

describe('resolveProjectAccess — live project', () => {
  it('opens the project to an ADMIN and a SUPERVISOR without querying membership', async () => {
    await expect(resolveProjectAccess(3, Role.ADMIN, 7)).resolves.toBe('granted');
    await expect(resolveProjectAccess(3, Role.SUPERVISOR, 7)).resolves.toBe('granted');
    expect(membership).not.toHaveBeenCalled();
  });

  it('opens the project to a member and refuses it to a non-member', async () => {
    member();
    await expect(resolveProjectAccess(3, Role.ARTIST, 7)).resolves.toBe('granted');
    notMember();
    await expect(resolveProjectAccess(3, Role.ARTIST, 7)).resolves.toBe('not-member');
  });
});

describe('resolveProjectAccess — project in the trash', () => {
  it('refuses a member, and also refuses an ADMIN: global access does not reopen the trash', async () => {
    trashedProject();
    member();
    await expect(resolveProjectAccess(3, Role.ARTIST, 7)).resolves.toBe('unavailable');
    await expect(resolveProjectAccess(3, Role.ADMIN, 7)).resolves.toBe('unavailable');
  });

  it('returns the same verdict as for a nonexistent project: removal cannot be guessed', async () => {
    trashedProject();
    const trashed = await resolveProjectAccess(3, Role.ADMIN, 7);
    missingProject();
    await expect(resolveProjectAccess(3, Role.ADMIN, 7)).resolves.toBe(trashed);
  });

  it('stays visible for a "trash" entry point (restore, purge)', async () => {
    trashedProject();
    member();
    await expect(resolveProjectAccess(3, Role.ARTIST, 7, { includeTrashed: true })).resolves.toBe('granted');
    await expect(resolveProjectAccess(3, Role.ADMIN, 7, { includeTrashed: true })).resolves.toBe('granted');
  });

  it('still does not resurrect a purged project, even in trash mode', async () => {
    missingProject();
    await expect(resolveProjectAccess(3, Role.ADMIN, 7, { includeTrashed: true })).resolves.toBe(
      'unavailable',
    );
  });
});

/**
 * A1-03: the root cause, not its three symptoms.
 *
 * The guard only granted on the EXISTENCE of the `ProjectMembership` and ignored its `role` field. Every
 * caller that wrote therefore had to remember to double the guard with an `assertCanContribute`, and
 * three had forgotten it (timeline markers, media management, the Excalidraw board): an ARTIST demoted to
 * CLIENT on a project kept their membership, the guard said yes, and they wrote.
 *
 * The intent moves the decision INTO the guard: a caller can no longer forget the role, it can only
 * declare that it comes to read. It is the EFFECTIVE role that decides (local elevation and demotion
 * included), not the global role.
 */
describe('resolveProjectAccess — declared intent (38.E / A1-03)', () => {
  it('lets a member CLIENT read: reading and commenting is their job', async () => {
    member();
    await expect(resolveProjectAccess(3, Role.CLIENT, 7)).resolves.toBe('granted');
    await expect(resolveProjectAccess(3, Role.CLIENT, 7, { intent: 'read' })).resolves.toBe('granted');
  });

  it('refuses writing to a member CLIENT: this is the defect that let it through', async () => {
    member();
    await expect(resolveProjectAccess(3, Role.CLIENT, 7, { intent: 'write' })).resolves.toBe(
      'insufficient-role',
    );
  });

  it('refuses writing to an ARTIST demoted to CLIENT on this project, despite the global role', async () => {
    memberAs(Role.CLIENT);
    await expect(resolveProjectAccess(3, Role.ARTIST, 7, { intent: 'read' })).resolves.toBe('granted');
    await expect(resolveProjectAccess(3, Role.ARTIST, 7, { intent: 'write' })).resolves.toBe(
      'insufficient-role',
    );
  });

  it('lets an ARTIST promoted to SUPERVISOR manage this project, without a global right', async () => {
    memberAs(Role.SUPERVISOR);
    await expect(resolveProjectAccess(3, Role.ARTIST, 7, { intent: 'manage' })).resolves.toBe('granted');
  });

  it('refuses management to a member ARTIST, who can nonetheless write', async () => {
    member();
    await expect(resolveProjectAccess(3, Role.ARTIST, 7, { intent: 'write' })).resolves.toBe('granted');
    await expect(resolveProjectAccess(3, Role.ARTIST, 7, { intent: 'manage' })).resolves.toBe(
      'insufficient-role',
    );
  });

  it('distinguishes a non-member from a member with an insufficient role', async () => {
    // Two 403s, but not the same message: "no access to this project" would be a lie to someone who
    // can see it perfectly well.
    notMember();
    await expect(resolveProjectAccess(3, Role.ARTIST, 7, { intent: 'write' })).resolves.toBe('not-member');
  });

  it('lets the trash take precedence over intent: a removed project is no more writable', async () => {
    trashedProject();
    memberAs(Role.SUPERVISOR);
    await expect(resolveProjectAccess(3, Role.ARTIST, 7, { intent: 'write' })).resolves.toBe('unavailable');
  });
});

describe('assertProjectAccess — declared intent', () => {
  it('refuses a write with a 403 ROLE_FORBIDDEN, not with "no access"', async () => {
    memberAs(Role.CLIENT);
    const err = await assertProjectAccess(requestOf(Role.ARTIST), 7, { intent: 'write' }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).statusCode).toBe(403);
    expect((err as AppError).code).toBe('ROLE_FORBIDDEN');
  });

  it('lets the same write through for a member ARTIST', async () => {
    member();
    await expect(
      assertProjectAccess(requestOf(Role.ARTIST), 7, { intent: 'write' }),
    ).resolves.toBeUndefined();
  });
});

describe('checkProjectAccess', () => {
  it('returns true only for a granted access, and passes the trash option through', async () => {
    member();
    await expect(checkProjectAccess(3, Role.ARTIST, 7)).resolves.toBe(true);
    trashedProject();
    await expect(checkProjectAccess(3, Role.ARTIST, 7)).resolves.toBe(false);
    await expect(checkProjectAccess(3, Role.ARTIST, 7, { includeTrashed: true })).resolves.toBe(true);
  });
});

describe('assertProjectAccess', () => {
  it('lets a member of a live project through', async () => {
    member();
    await expect(assertProjectAccess(requestOf(Role.ARTIST), 7)).resolves.toBeUndefined();
  });

  it('refuses a non-member with a 403: the project exists, it is just not open to them', async () => {
    await expect(assertProjectAccess(requestOf(Role.ARTIST), 7)).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it('refuses direct access to a resource of a project in the trash with a 404, member or admin', async () => {
    trashedProject();
    member();
    await expect(assertProjectAccess(requestOf(Role.ARTIST), 7)).rejects.toMatchObject({
      statusCode: 404,
    });
    await expect(assertProjectAccess(requestOf(Role.ADMIN), 7)).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('does not name the project in the 404: the body stays the generic response', async () => {
    trashedProject();
    const err = await assertProjectAccess(requestOf(Role.ADMIN), 7).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('NOT_FOUND');
    expect((err as AppError).message).not.toMatch(/project/i);
  });

  it('grants access to the "trash" entry points that explicitly request it', async () => {
    trashedProject();
    await expect(
      assertProjectAccess(requestOf(Role.ADMIN), 7, { includeTrashed: true }),
    ).resolves.toBeUndefined();
  });

  it('refuses an unauthenticated request', async () => {
    await expect(assertProjectAccess({ params: {} } as unknown as Request, 7)).rejects.toMatchObject({
      statusCode: 401,
    });
  });
});

describe('requireProjectAccess', () => {
  it('lets a member of a live project through', async () => {
    member();
    const { err } = await run(requireProjectAccess, requestOf(Role.ARTIST));
    expect(err).toBeUndefined();
  });

  it('refuses a non-member (403) and a project in the trash (404)', async () => {
    expect(statusOf((await run(requireProjectAccess, requestOf(Role.ARTIST))).err)).toBe(403);
    trashedProject();
    member();
    expect(statusOf((await run(requireProjectAccess, requestOf(Role.ARTIST))).err)).toBe(404);
    expect(statusOf((await run(requireProjectAccess, requestOf(Role.ADMIN))).err)).toBe(404);
  });

  it('responds 400 to a projectId that is not an integer, without querying the database', async () => {
    const { status, err } = await run(requireProjectAccess, requestOf(Role.ADMIN, { projectId: 'abc' }));
    expect(status).toBe(400);
    expect(err).toBeUndefined();
    expect(projectCount).not.toHaveBeenCalled();
  });
});

describe('requireProjectManage', () => {
  it('lets an ADMIN manage a live project', async () => {
    const { err } = await run(requireProjectManage, requestOf(Role.ADMIN));
    expect(err).toBeUndefined();
  });

  it('refuses managing a project in the trash with a 404: restore it first', async () => {
    trashedProject();
    expect(statusOf((await run(requireProjectManage, requestOf(Role.ADMIN))).err)).toBe(404);
  });

  it('still refuses an insufficient role on a live project (403)', async () => {
    member();
    expect(statusOf((await run(requireProjectManage, requestOf(Role.CLIENT))).err)).toBe(403);
  });

  it('remains sensitive to local elevation after the rewrite on intent (38.E)', async () => {
    // The guard now goes through `resolveProjectAccess({ intent: 'manage' })`: the test checks that the
    // rewrite did not lose the elevation by membership, which is the whole reason for `requireProjectManage`.
    memberAs(Role.SUPERVISOR);
    expect((await run(requireProjectManage, requestOf(Role.ARTIST))).err).toBeUndefined();
    memberAs(Role.CLIENT);
    expect(statusOf((await run(requireProjectManage, requestOf(Role.ARTIST))).err)).toBe(403);
  });
});

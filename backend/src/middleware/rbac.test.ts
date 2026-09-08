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
 * Garde d'appartenance projet.
 *
 * Le défaut couvert ici : la garde ne regardait que `ProjectMembership` et jamais
 * `Project.deletedAt`. Les listes filtraient bien les projets en corbeille, mais l'accès
 * DIRECT par URL à un média, un plan, une séquence ou un asset d'un projet retiré restait
 * ouvert — y compris à un ADMIN, dont l'accès est global. Le retrait se contournait donc
 * en connaissant l'URL, et l'incohérence liste/URL rendait la faute invisible à l'usage.
 *
 * Le double de Prisma est réduit à ce que la garde interroge : `project.count` (le projet
 * est-il désignable ?) et `projectMembership.findUnique` (en est-on membre ?).
 */

const projectCount = vi.mocked(prisma.project.count);
const membership = vi.mocked(prisma.projectMembership.findUnique);

/** Le projet 7 existe et n'est pas à la corbeille. */
const liveProject = () => projectCount.mockResolvedValue(1);
/** Le projet 7 est à la corbeille : `count` ne le voit qu'avec `includeTrashed`. */
const trashedProject = () =>
  projectCount.mockImplementation(
    (args: unknown) =>
      Promise.resolve((args as { where: { deletedAt?: unknown } }).where.deletedAt === null ? 0 : 1) as never,
  );
/** Le projet 7 n'a jamais existé. */
const missingProject = () => projectCount.mockResolvedValue(0);

const member = () => membership.mockResolvedValue({ userId: 3, projectId: 7 } as never);
const notMember = () => membership.mockResolvedValue(null);

const requestOf = (role: Role, params: Record<string, string> = { projectId: '7' }): Request =>
  ({ user: { id: 3, email: 'a@studio.com', role }, params }) as unknown as Request;

/** Joue un middleware et rend ce qu'il a passé à `next` (une erreur, ou rien). */
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

describe('resolveProjectAccess — projet vivant', () => {
  it('ouvre le projet à un ADMIN et à un SUPERVISOR sans interroger l’appartenance', async () => {
    await expect(resolveProjectAccess(3, Role.ADMIN, 7)).resolves.toBe('granted');
    await expect(resolveProjectAccess(3, Role.SUPERVISOR, 7)).resolves.toBe('granted');
    expect(membership).not.toHaveBeenCalled();
  });

  it('ouvre le projet à un membre et le refuse à un non-membre', async () => {
    member();
    await expect(resolveProjectAccess(3, Role.ARTIST, 7)).resolves.toBe('granted');
    notMember();
    await expect(resolveProjectAccess(3, Role.ARTIST, 7)).resolves.toBe('not-member');
  });
});

describe('resolveProjectAccess — projet à la corbeille', () => {
  it('refuse un membre, et refuse aussi un ADMIN : l’accès global ne rouvre pas la corbeille', async () => {
    trashedProject();
    member();
    await expect(resolveProjectAccess(3, Role.ARTIST, 7)).resolves.toBe('unavailable');
    await expect(resolveProjectAccess(3, Role.ADMIN, 7)).resolves.toBe('unavailable');
  });

  it('rend le même verdict qu’un projet inexistant — le retrait ne se devine pas', async () => {
    trashedProject();
    const trashed = await resolveProjectAccess(3, Role.ADMIN, 7);
    missingProject();
    await expect(resolveProjectAccess(3, Role.ADMIN, 7)).resolves.toBe(trashed);
  });

  it('reste visible pour un point d’entrée « corbeille » (restauration, purge)', async () => {
    trashedProject();
    member();
    await expect(resolveProjectAccess(3, Role.ARTIST, 7, { includeTrashed: true })).resolves.toBe('granted');
    await expect(resolveProjectAccess(3, Role.ADMIN, 7, { includeTrashed: true })).resolves.toBe('granted');
  });

  it('ne ressuscite pas pour autant un projet purgé, même en mode corbeille', async () => {
    missingProject();
    await expect(resolveProjectAccess(3, Role.ADMIN, 7, { includeTrashed: true })).resolves.toBe(
      'unavailable',
    );
  });
});

describe('checkProjectAccess', () => {
  it('ne dit vrai que pour un accès accordé, et transmet l’option corbeille', async () => {
    member();
    await expect(checkProjectAccess(3, Role.ARTIST, 7)).resolves.toBe(true);
    trashedProject();
    await expect(checkProjectAccess(3, Role.ARTIST, 7)).resolves.toBe(false);
    await expect(checkProjectAccess(3, Role.ARTIST, 7, { includeTrashed: true })).resolves.toBe(true);
  });
});

describe('assertProjectAccess', () => {
  it('laisse passer un membre d’un projet vivant', async () => {
    member();
    await expect(assertProjectAccess(requestOf(Role.ARTIST), 7)).resolves.toBeUndefined();
  });

  it('refuse un non-membre par un 403 — le projet existe, il ne lui est pas ouvert', async () => {
    await expect(assertProjectAccess(requestOf(Role.ARTIST), 7)).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it('refuse l’accès direct à une ressource d’un projet en corbeille par un 404, membre ou admin', async () => {
    trashedProject();
    member();
    await expect(assertProjectAccess(requestOf(Role.ARTIST), 7)).rejects.toMatchObject({
      statusCode: 404,
    });
    await expect(assertProjectAccess(requestOf(Role.ADMIN), 7)).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('ne nomme pas le projet dans le 404 : le corps reste la réponse générique', async () => {
    trashedProject();
    const err = await assertProjectAccess(requestOf(Role.ADMIN), 7).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('NOT_FOUND');
    expect((err as AppError).message).not.toMatch(/project/i);
  });

  it('rend l’accès aux points d’entrée « corbeille » qui le demandent explicitement', async () => {
    trashedProject();
    await expect(
      assertProjectAccess(requestOf(Role.ADMIN), 7, { includeTrashed: true }),
    ).resolves.toBeUndefined();
  });

  it('refuse une requête non authentifiée', async () => {
    await expect(assertProjectAccess({ params: {} } as unknown as Request, 7)).rejects.toMatchObject({
      statusCode: 401,
    });
  });
});

describe('requireProjectAccess', () => {
  it('laisse passer un membre d’un projet vivant', async () => {
    member();
    const { err } = await run(requireProjectAccess, requestOf(Role.ARTIST));
    expect(err).toBeUndefined();
  });

  it('refuse un non-membre (403) et un projet en corbeille (404)', async () => {
    expect(statusOf((await run(requireProjectAccess, requestOf(Role.ARTIST))).err)).toBe(403);
    trashedProject();
    member();
    expect(statusOf((await run(requireProjectAccess, requestOf(Role.ARTIST))).err)).toBe(404);
    expect(statusOf((await run(requireProjectAccess, requestOf(Role.ADMIN))).err)).toBe(404);
  });

  it('répond 400 sur un projectId qui n’est pas un entier, sans interroger la base', async () => {
    const { status, err } = await run(requireProjectAccess, requestOf(Role.ADMIN, { projectId: 'abc' }));
    expect(status).toBe(400);
    expect(err).toBeUndefined();
    expect(projectCount).not.toHaveBeenCalled();
  });
});

describe('requireProjectManage', () => {
  it('laisse gérer un projet vivant à un ADMIN', async () => {
    const { err } = await run(requireProjectManage, requestOf(Role.ADMIN));
    expect(err).toBeUndefined();
  });

  it('refuse la gestion d’un projet en corbeille par un 404 — restaurer d’abord', async () => {
    trashedProject();
    expect(statusOf((await run(requireProjectManage, requestOf(Role.ADMIN))).err)).toBe(404);
  });

  it('refuse encore un rôle insuffisant sur un projet vivant (403)', async () => {
    expect(statusOf((await run(requireProjectManage, requestOf(Role.CLIENT))).err)).toBe(403);
  });
});

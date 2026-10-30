// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma, Role } from '@prisma/client';

// Ensures must remain replayable even when the SQL constraint sees an entity that the prior lookup ignores
// (trash) or that a concurrent request has just created. The database is mocked: only the recovery from P2002
// is under test.
vi.mock('../lib/prisma', () => ({
  prisma: {
    sequence: { findFirst: vi.fn(), create: vi.fn() },
    shot: { findFirst: vi.fn(), create: vi.fn() },
    asset: { findFirst: vi.fn(), create: vi.fn() },
    task: { findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
    version: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
  },
}));
vi.mock('./SocketService', () => ({ emitToProject: vi.fn() }));
vi.mock('../lib/projectGuard', () => ({ assertProjectWritable: vi.fn() }));
vi.mock('../lib/projectRoles', () => ({
  assertProjectManage: vi.fn(),
  assertCanContribute: vi.fn(),
}));

import { ensureSequence, ensureShot, ensureAsset, ensureTask, ensureVersion } from './PipelineEnsureService';
import { prisma } from '../lib/prisma';
import { emitToProject } from './SocketService';

const admin = { id: 1, role: Role.ADMIN };

const uniqueViolation = () =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ensureAsset: idempotent in the face of the trash and of concurrency', () => {
  it('returns the existing asset without creating it (created: false)', async () => {
    const existing = { id: 59, name: 'crag' };
    vi.mocked(prisma.asset.findFirst).mockResolvedValue(existing as never);
    const out = await ensureAsset(admin, 7, { name: 'crag' });
    expect(out).toEqual({ entity: existing, created: false });
    expect(prisma.asset.create).not.toHaveBeenCalled();
  });

  it('answers 409 ASSET_IN_TRASH when the name is held by a deleted asset', async () => {
    vi.mocked(prisma.asset.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.asset.create).mockRejectedValue(uniqueViolation());
    await expect(ensureAsset(admin, 7, { name: 'crag' })).rejects.toMatchObject({
      statusCode: 409,
      code: 'ASSET_IN_TRASH',
    });
    expect(emitToProject).not.toHaveBeenCalled();
  });

  it('returns the asset created by a concurrent request (created: false)', async () => {
    const winner = { id: 96, name: 'crag' };
    vi.mocked(prisma.asset.findFirst)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(winner as never);
    vi.mocked(prisma.asset.create).mockRejectedValue(uniqueViolation());
    const out = await ensureAsset(admin, 7, { name: 'crag' });
    expect(out).toEqual({ entity: winner, created: false });
    expect(emitToProject).not.toHaveBeenCalled();
  });

  it('lets through errors that are not a uniqueness violation', async () => {
    vi.mocked(prisma.asset.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.asset.create).mockRejectedValue(new Error('connexion perdue'));
    await expect(ensureAsset(admin, 7, { name: 'crag' })).rejects.toThrow('connexion perdue');
  });
});

describe('ensureSequence: idempotent in the face of the trash and of concurrency', () => {
  it('answers 409 SEQUENCE_IN_TRASH when the code is held by a deleted sequence', async () => {
    vi.mocked(prisma.sequence.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.sequence.create).mockRejectedValue(uniqueViolation());
    await expect(ensureSequence(admin, 7, { code: 'SQ010' })).rejects.toMatchObject({
      statusCode: 409,
      code: 'SEQUENCE_IN_TRASH',
    });
  });

  it('returns the sequence created by a concurrent request (created: false)', async () => {
    const winner = { id: 4, code: 'SQ010' };
    vi.mocked(prisma.sequence.findFirst)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(winner as never);
    vi.mocked(prisma.sequence.create).mockRejectedValue(uniqueViolation());
    const out = await ensureSequence(admin, 7, { code: 'SQ010' });
    expect(out).toEqual({ entity: winner, created: false });
  });
});

describe('ensureTask: idempotent in the face of concurrency', () => {
  // The name "main" gives no hint of any department: department resolution does not come into play.
  const task = { name: 'main' };

  it('returns the task created by a concurrent request (created: false)', async () => {
    // Two simultaneous publications from a render farm: only one task must exist.
    const winner = { id: 77, name: 'main' };
    vi.mocked(prisma.task.findFirst)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(winner as never);
    vi.mocked(prisma.task.create).mockRejectedValue(uniqueViolation());
    const out = await ensureTask(admin, 7, { shotId: 3 }, task);
    expect(out).toEqual({ entity: winner, created: false });
    expect(emitToProject).not.toHaveBeenCalled();
  });

  it('answers 409 TASK_EXISTS when the re-read finds nothing', async () => {
    vi.mocked(prisma.task.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.task.create).mockRejectedValue(uniqueViolation());
    await expect(ensureTask(admin, 7, { shotId: 3 }, task)).rejects.toMatchObject({
      statusCode: 409,
      code: 'TASK_EXISTS',
    });
  });

  it('lets through errors that are not a uniqueness violation', async () => {
    vi.mocked(prisma.task.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.task.create).mockRejectedValue(new Error('connexion perdue'));
    await expect(ensureTask(admin, 7, { shotId: 3 }, task)).rejects.toThrow('connexion perdue');
  });
});

describe('ensureVersion: idempotent in the face of the trash and of concurrency', () => {
  const parent = { taskId: 5 };

  it("recomputes the number rather than returning a colleague's version", async () => {
    // With no name requested, the caller wants THE NEXT ONE: returning the V02 that the other publication has
    // just created would attach their media to a colleague's work.
    vi.mocked(prisma.version.findMany)
      .mockResolvedValueOnce([{ name: 'V01' }] as never)
      .mockResolvedValueOnce([{ name: 'V01' }, { name: 'V02' }] as never);
    vi.mocked(prisma.version.create)
      .mockRejectedValueOnce(uniqueViolation())
      .mockResolvedValueOnce({ id: 31, name: 'V03' } as never);
    const out = await ensureVersion(admin, 7, parent);
    expect(out).toEqual({ entity: { id: 31, name: 'V03' }, created: true });
    const names = vi.mocked(prisma.version.create).mock.calls.map((c) => c[0].data.name);
    expect(names).toEqual(['V02', 'V03']);
  });

  it('gives up cleanly if the number remains taken', async () => {
    vi.mocked(prisma.version.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.version.create).mockRejectedValue(uniqueViolation());
    await expect(ensureVersion(admin, 7, parent)).rejects.toMatchObject({
      statusCode: 409,
      code: 'VERSION_RACE',
    });
    expect(prisma.version.create).toHaveBeenCalledTimes(3);
  });

  it('answers 409 VERSION_IN_TRASH when the name is held by a deleted version', async () => {
    vi.mocked(prisma.version.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.version.create).mockRejectedValue(uniqueViolation());
    await expect(ensureVersion(admin, 7, parent, { name: 'V03' })).rejects.toMatchObject({
      statusCode: 409,
      code: 'VERSION_IN_TRASH',
    });
  });

  it('returns the version created by a concurrent request when resumption is requested', async () => {
    const winner = { id: 12, name: 'V03' };
    vi.mocked(prisma.version.findFirst)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(winner as never);
    vi.mocked(prisma.version.create).mockRejectedValue(uniqueViolation());
    const out = await ensureVersion(admin, 7, parent, { name: 'V03', reuseExisting: true });
    expect(out).toEqual({ entity: winner, created: false });
    expect(emitToProject).not.toHaveBeenCalled();
  });

  it('refuses to overwrite the version of a concurrent request without explicit resumption', async () => {
    vi.mocked(prisma.version.findFirst)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 12, name: 'V03' } as never);
    vi.mocked(prisma.version.create).mockRejectedValue(uniqueViolation());
    await expect(ensureVersion(admin, 7, parent, { name: 'V03' })).rejects.toMatchObject({
      code: 'VERSION_EXISTS',
    });
  });
});

describe('ensureShot: idempotent in the face of the trash and of concurrency', () => {
  it('answers 409 SHOT_IN_TRASH when the code is held by a deleted shot', async () => {
    vi.mocked(prisma.sequence.findFirst).mockResolvedValue({ id: 4 } as never);
    vi.mocked(prisma.shot.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.shot.create).mockRejectedValue(uniqueViolation());
    await expect(ensureShot(admin, 7, { code: 'SH0100', sequenceCode: 'SQ010' })).rejects.toMatchObject({
      statusCode: 409,
      code: 'SHOT_IN_TRASH',
    });
  });

  it('returns the shot created by a concurrent request (created: false)', async () => {
    const winner = { id: 8, code: 'SH0100' };
    vi.mocked(prisma.sequence.findFirst).mockResolvedValue({ id: 4 } as never);
    vi.mocked(prisma.shot.findFirst)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(winner as never);
    vi.mocked(prisma.shot.create).mockRejectedValue(uniqueViolation());
    const out = await ensureShot(admin, 7, { code: 'SH0100', sequenceCode: 'SQ010' });
    expect(out).toEqual({ entity: winner, created: false });
  });
});

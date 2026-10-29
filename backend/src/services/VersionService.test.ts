// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/prisma', () => ({
  prisma: {
    version: { count: vi.fn(), create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn() },
        // Project writable by default (38.B): the archive lock queries project.findFirst.
    project: { findFirst: vi.fn().mockResolvedValue({ status: 'ACTIVE' }) },
        // A version's name now depends on the project: linked or not, and under which parent.
    shotgridConnection: { findUnique: vi.fn() },
    task: { findUnique: vi.fn() },
    asset: { findUnique: vi.fn() },
        // Rights are read from the EFFECTIVE role (38.E): by default, a member without a local role
        // (hence a contributor on the global role), which the cases below already tested.
    projectMembership: { findUnique: vi.fn().mockResolvedValue({ role: null }) },
  },
}));
vi.mock('./SocketService', () => ({ emitToProject: vi.fn() }));
vi.mock('../lib/trash', () => ({
  softDeleteVersion: vi.fn(),
  restoreVersion: vi.fn(),
  purgeVersion: vi.fn(),
}));
vi.mock('./AuditService', () => ({ logAudit: vi.fn() }));

import { create, update, publishAll, purge, remove, list } from './VersionService';
import { prisma } from '../lib/prisma';
import { emitToProject } from './SocketService';
import { purgeVersion } from '../lib/trash';
import { Role, VersionStatus } from '@prisma/client';

const siblings = vi.mocked(prisma.version.findMany);
const connection = vi.mocked(prisma.shotgridConnection.findUnique);
const task = vi.mocked(prisma.task.findUnique);
const asset = vi.mocked(prisma.asset.findUnique);
const createVersion = vi.mocked(prisma.version.create);
const findUnique = vi.mocked(prisma.version.findUnique);
const updateVersion = vi.mocked(prisma.version.update);
const membership = vi.mocked(prisma.projectMembership.findUnique);
const user = { id: 3, role: Role.ARTIST };

describe('VersionService.create: automatic version naming', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createVersion.mockImplementation(({ data }) => Promise.resolve({ id: 1, ...data }) as never);
    siblings.mockResolvedValue([] as never);
    connection.mockResolvedValue(null);
    task.mockResolvedValue(null);
    asset.mockResolvedValue(null);
  });

  it('names V01 when no version exists yet', async () => {
    await create(user, 7, { taskId: 42 });
    expect(createVersion).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ name: 'V01', taskId: 42, authorId: 3 }) }),
    );
    expect(emitToProject).toHaveBeenCalledWith(
      7,
      'version:update',
      expect.objectContaining({ projectId: 7, taskId: 42 }),
    );
  });

  it('continues above the highest number, never at the version count', async () => {
        // Counting regressed as soon as a version was deleted: two V03 ended up naming two different pieces of work.
    siblings.mockResolvedValue([{ name: 'V01' }, { name: 'V09' }] as never);
    await create(user, 7, { assetId: 5 });
    expect(createVersion).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ name: 'V10', assetId: 5 }) }),
    );
  });

  it('follows the site convention when the project is linked to it', async () => {
    connection.mockResolvedValue({ active: true } as never);
    task.mockResolvedValue({ department: 'anim', shot: { code: 'DEMO_SH010' }, asset: null } as never);
    siblings.mockResolvedValue([{ name: 'DEMO_SH010_anim_v002' }] as never);

    await create(user, 7, { taskId: 42 });

    expect(createVersion).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ name: 'DEMO_SH010_anim_v003' }) }),
    );
  });

  it('respects an explicit name without computing anything', async () => {
    await create(user, 7, { taskId: 1, name: 'Final' });
    expect(siblings).not.toHaveBeenCalled();
    expect(createVersion).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ name: 'Final' }) }),
    );
  });
});

describe('VersionService.update: publication lock on the transform (Phase 11)', () => {
  const transform = { position: [0, 0, 0], quaternion: [0, 0, 0, 1], scale: [1, 1, 1] };

  beforeEach(() => {
    vi.clearAllMocks();
    updateVersion.mockImplementation(
      ({ data }) => Promise.resolve({ id: 1, taskId: 42, assetId: null, ...data }) as never,
    );
  });

  it('refuses the transform on a published version (403 PUBLISHED_LOCKED)', async () => {
    findUnique.mockResolvedValue({ authorId: 3, published: true } as never);
    await expect(update(user, 7, 1, { transform })).rejects.toMatchObject({
      statusCode: 403,
      code: 'PUBLISHED_LOCKED',
    });
    expect(updateVersion).not.toHaveBeenCalled();
  });

  it('accepts the transform on an unpublished version (author)', async () => {
    findUnique.mockResolvedValue({ authorId: 3, published: false } as never);
    await update(user, 7, 1, { transform });
    expect(updateVersion).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ transform }) }),
    );
  });

  it('still allows renaming a published version (only the transform is frozen)', async () => {
    findUnique.mockResolvedValue({ authorId: 3, published: true } as never);
    await update(user, 7, 1, { name: 'V02_final' });
    expect(updateVersion).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ name: 'V02_final' }) }),
    );
  });
});

/**
 * The authorization model is that of the EFFECTIVE role on the project (38.E). The competing model, a
 * `isGlobalManager(user.role)` copied into the service, judged on the global role: it refused a supervisor named on THIS
 * project from publishing what they supervise, and let a member demoted to CLIENT create versions there.
 */
describe('VersionService: effective project role (38.E)', () => {
  const artist = { id: 3, role: Role.ARTIST };

  beforeEach(() => {
    vi.clearAllMocks();
    membership.mockResolvedValue({ role: null } as never);
    updateVersion.mockImplementation(
      ({ data }) => Promise.resolve({ id: 1, taskId: 42, assetId: null, ...data }) as never,
    );
    siblings.mockResolvedValue([] as never);
    connection.mockResolvedValue(null);
    task.mockResolvedValue(null);
    asset.mockResolvedValue(null);
    createVersion.mockImplementation(({ data }) => Promise.resolve({ id: 1, ...data }) as never);
  });

  it('an ARTIST promoted to SUPERVISOR on the project publishes a version they did not author', async () => {
    membership.mockResolvedValue({ role: Role.SUPERVISOR } as never);
    findUnique.mockResolvedValue({ authorId: 99, published: false } as never);
    await update(artist, 7, 1, { status: VersionStatus.PUBLISHED });
    expect(updateVersion).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: VersionStatus.PUBLISHED, published: true }),
      }),
    );
  });

  it('an ARTIST without local elevation does not publish someone else\'s version (403)', async () => {
    findUnique.mockResolvedValue({ authorId: 99, published: false } as never);
    await expect(update(artist, 7, 1, { status: VersionStatus.PUBLISHED })).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(updateVersion).not.toHaveBeenCalled();
  });

  it('an ARTIST demoted to CLIENT on the project no longer creates versions (403 ROLE_FORBIDDEN)', async () => {
    membership.mockResolvedValue({ role: Role.CLIENT } as never);
    await expect(create(artist, 7, { taskId: 42 })).rejects.toMatchObject({
      statusCode: 403,
      code: 'ROLE_FORBIDDEN',
    });
    expect(createVersion).not.toHaveBeenCalled();
  });

  it('an ARTIST demoted to CLIENT on the project no longer publishes drafts (403)', async () => {
    membership.mockResolvedValue({ role: Role.CLIENT } as never);
    await expect(publishAll(artist, 7, 1)).rejects.toMatchObject({ statusCode: 403 });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('non-member: no creation possible, even with a global artist role', async () => {
    membership.mockResolvedValue(null);
    await expect(create(artist, 7, { taskId: 42 })).rejects.toMatchObject({ statusCode: 403 });
  });

  it('an ARTIST promoted to SUPERVISOR purges and deletes on their project', async () => {
    membership.mockResolvedValue({ role: Role.SUPERVISOR } as never);
    findUnique.mockResolvedValue({ authorId: 99, taskId: 42, assetId: null } as never);
    await purge(artist, 7, 1);
    expect(purgeVersion).toHaveBeenCalledWith(1);
    await expect(remove(artist, 7, 1)).resolves.toBeUndefined();
  });

  it('an ARTIST without elevation does not purge (403), even as the version author', async () => {
    findUnique.mockResolvedValue({ authorId: 3, taskId: 42, assetId: null } as never);
    await expect(purge(artist, 7, 1)).rejects.toMatchObject({ statusCode: 403 });
    expect(purgeVersion).not.toHaveBeenCalled();
  });
});

describe('VersionService.list: counting aligned with real visibility (10.C2)', () => {
  beforeEach(() => vi.clearAllMocks());

    /*
     * This filter used to be guarded by the integration scenario "project flow -> ... -> media", which dropped a draft and
     * checked that another member did not count it. Since Phase 50 a media is born PUBLISHED (draft mode off by default): that
     * scenario can no longer produce a draft, and the filter would have no guard there. Here we do not go through the upload:
     * we check the query emitted, hence the filter itself. It is indeed the clause that is locked, not the database behaviour.
     */
  it('counts an unpublished media only for its uploader', async () => {
    siblings.mockResolvedValue([] as never);

    await list(42, 7);

    const [args] = siblings.mock.calls[0] as [
      { include: { _count: { select: { media: { where: unknown } } } } },
    ];
    expect(args.include._count.select.media.where).toEqual({
      deletedAt: null,
      OR: [{ published: true }, { uploaderId: 42 }],
    });
  });

  it('never returns other people\'s drafts in `draftCount`', async () => {
    siblings.mockResolvedValue([{ id: 1, media: [{ id: 9 }] }] as never);

    const versions = await list(42, 7);

    const [args] = siblings.mock.calls[0] as [{ include: { media: { where: unknown } } }];
    expect(args.include.media.where).toMatchObject({ published: false, uploaderId: 42 });
    expect(versions[0]).toMatchObject({ id: 1, draftCount: 1 });
    expect(versions[0]).not.toHaveProperty('media');
  });
});

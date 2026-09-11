// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Role, WatchTargetType } from '@prisma/client';

vi.mock('../lib/prisma', () => ({
  prisma: {
    version: { findFirst: vi.fn(), update: vi.fn() },
    mediaObject: { findFirst: vi.fn() },
    user: { findMany: vi.fn() },
  },
}));
vi.mock('../lib/projectGuard', () => ({ assertProjectWritable: vi.fn() }));
vi.mock('../lib/projectRoles', () => ({
  assertProjectManage: vi.fn(),
  canContribute: (role: Role) => role !== Role.CLIENT,
  effectiveProjectRole: vi.fn(async (_id: number, role: Role) => role),
}));
vi.mock('./SocketService', () => ({ emitToProject: vi.fn() }));
vi.mock('./AuditService', () => ({ logAudit: vi.fn() }));
vi.mock('./NotificationService', () => ({ notify: vi.fn() }));
vi.mock('./WatchService', () => ({ setWatch: vi.fn() }));
// La photo est signée par le service : le test vérifie la forme rendue, pas la signature.
vi.mock('../lib/userView', () => ({ avatarUrl: vi.fn(async (key: string | null) => key && `url:${key}`) }));

import { listReviewers, setReviewers } from './ReviewAssignmentService';
import { prisma } from '../lib/prisma';
import { emitToProject } from './SocketService';
import { logAudit } from './AuditService';
import { notify } from './NotificationService';
import { setWatch } from './WatchService';

const person = (id: number, name: string) => ({
  id,
  name,
  firstName: null,
  lastName: null,
  username: null,
  email: `${name}@studio.test`,
  avatarKey: null,
  jobTitle: null,
});

const supervisor = { id: 1, role: Role.SUPERVISOR };

/** Version vivante + reviewers déjà posés, dans l'ordre où le service les lit. */
function given(current: ReturnType<typeof person>[], after: ReturnType<typeof person>[]) {
  vi.mocked(prisma.version.findFirst)
    // loadVersion
    .mockResolvedValueOnce({ id: 42, name: 'V03', taskId: 7, assetId: null } as never)
    // listReviewers (état d'avant)
    .mockResolvedValueOnce({ reviewers: current } as never);
  vi.mocked(prisma.version.update).mockResolvedValue({ reviewers: after } as never);
  vi.mocked(prisma.mediaObject.findFirst).mockResolvedValue({ id: 500 } as never);
}

/**
 * `clearAllMocks` efface les appels mais garde les valeurs posées avec `…Once` : un test
 * qui échoue avant d'avoir consommé les siennes les léguerait au suivant, et la version
 * « inconnue » du dernier test reviendrait bien vivante.
 */
function resetDb() {
  vi.clearAllMocks();
  vi.mocked(prisma.version.findFirst).mockReset();
  vi.mocked(prisma.version.update).mockReset();
  vi.mocked(prisma.mediaObject.findFirst).mockReset();
  vi.mocked(prisma.user.findMany).mockReset();
}

beforeEach(resetDb);

describe('listReviewers', () => {
  it('rend les personnes confiées, photo signée', async () => {
    vi.mocked(prisma.version.findFirst).mockResolvedValue({
      reviewers: [{ ...person(4, 'alice'), avatarKey: 'a.png' }],
    } as never);
    await expect(listReviewers(42)).resolves.toEqual([
      expect.objectContaining({ id: 4, name: 'alice', avatarUrl: 'url:a.png' }),
    ]);
  });

  it('404 sur une version inconnue ou en corbeille', async () => {
    vi.mocked(prisma.version.findFirst).mockResolvedValue(null);
    await expect(listReviewers(999)).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('setReviewers', () => {
  const assignable = [
    { id: 4, role: Role.ARTIST, isService: false, disabledAt: null },
    { id: 5, role: Role.ARTIST, isService: false, disabledAt: null },
  ];

  it('remplace la liste, audite, émet, notifie et abonne les nouveaux', async () => {
    given([person(4, 'alice')], [person(4, 'alice'), person(5, 'bruno')]);
    vi.mocked(prisma.user.findMany).mockResolvedValue(assignable as never);

    const out = await setReviewers(supervisor, 3, 42, [4, 5]);

    expect(out.map((p) => p.id)).toEqual([4, 5]);
    expect(prisma.version.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { reviewers: { set: [{ id: 4 }, { id: 5 }] } } }),
    );
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'version.reviewers', entityId: 42 }),
    );
    expect(emitToProject).toHaveBeenCalledWith(3, 'version:update', expect.objectContaining({ id: 42 }));
    // Seul le nouveau venu est prévenu : Alice y était déjà.
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 5,
        type: 'REVIEW_ASSIGNED',
        messageKey: 'notification.reviewAssigned',
        params: { version: 'V03' },
        projectId: 3,
        // Le premier média de la version : c'est ce qui rend la notification navigable.
        referenceId: 500,
      }),
    );
    expect(setWatch).toHaveBeenCalledWith(5, WatchTargetType.VERSION, 42, true);
  });

  it('ne se notifie pas soi-même', async () => {
    given([], [person(1, 'sup')]);
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: 1, role: Role.SUPERVISOR, isService: false, disabledAt: null },
    ] as never);
    await setReviewers(supervisor, 3, 42, [1]);
    expect(notify).not.toHaveBeenCalled();
  });

  it('retirer quelqu’un n’avertit personne', async () => {
    given([person(4, 'alice'), person(5, 'bruno')], [person(4, 'alice')]);
    vi.mocked(prisma.user.findMany).mockResolvedValue([assignable[0]] as never);
    await setReviewers(supervisor, 3, 42, [4]);
    expect(notify).not.toHaveBeenCalled();
    expect(prisma.version.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { reviewers: { set: [{ id: 4 }] } } }),
    );
  });

  it('refuse un client et un compte de service, sans rien écrire', async () => {
    given([], []);
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: 6, role: Role.CLIENT, isService: false, disabledAt: null },
    ] as never);
    await expect(setReviewers(supervisor, 3, 42, [6])).rejects.toMatchObject({ statusCode: 400 });

    resetDb();
    given([], []);
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: 7, role: Role.ARTIST, isService: true, disabledAt: null },
    ] as never);
    await expect(setReviewers(supervisor, 3, 42, [7])).rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.version.update).not.toHaveBeenCalled();
  });

  it('dédoublonne la liste reçue', async () => {
    given([], [person(4, 'alice')]);
    vi.mocked(prisma.user.findMany).mockResolvedValue([assignable[0]] as never);
    await setReviewers(supervisor, 3, 42, [4, 4, 4]);
    expect(prisma.version.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { reviewers: { set: [{ id: 4 }] } } }),
    );
  });

  it('404 sur une version inconnue', async () => {
    vi.mocked(prisma.version.findFirst).mockResolvedValueOnce(null);
    await expect(setReviewers(supervisor, 3, 999, [4])).rejects.toMatchObject({ statusCode: 404 });
    expect(prisma.version.update).not.toHaveBeenCalled();
  });
});

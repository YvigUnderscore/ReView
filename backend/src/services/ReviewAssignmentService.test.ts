// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Role, WatchTargetType } from '@prisma/client';

vi.mock('../lib/prisma', () => ({
  prisma: {
    version: { findFirst: vi.fn() },
    mediaObject: { findFirst: vi.fn() },
    user: { findMany: vi.fn() },
    reviewAssignment: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
      deleteMany: vi.fn(),
    },
    $transaction: vi.fn(async (ops: unknown[]) => ops),
  },
}));
vi.mock('../lib/projectGuard', () => ({ assertProjectWritable: vi.fn() }));
vi.mock('../lib/projectRoles', () => ({
  isProjectManager: vi.fn(async () => true),
  canContribute: (role: Role) => role !== Role.CLIENT,
  effectiveProjectRole: vi.fn(async (_id: number, role: Role) => role),
}));
vi.mock('../lib/projectSettings', async (importOriginal) => ({
  // `checkReviewNote` EST la règle : la mocker reviendrait à tester le mock.
  ...(await importOriginal<typeof import('../lib/projectSettings')>()),
  resolveProjectSettingsById: vi.fn(),
}));
vi.mock('./SocketService', () => ({ emitToProject: vi.fn() }));
vi.mock('./AuditService', () => ({ logAudit: vi.fn() }));
vi.mock('./NotificationService', () => ({ notify: vi.fn() }));
vi.mock('./WatchService', () => ({ setWatch: vi.fn() }));
vi.mock('./ApiEventService', () => ({ publish: vi.fn() }));
// La photo est signée par le service : le test vérifie la forme rendue, pas la signature.
vi.mock('../lib/userView', () => ({ avatarUrl: vi.fn(async (key: string | null) => key && `url:${key}`) }));

import { listReviewers, setReviewers, updateNote } from './ReviewAssignmentService';
import { prisma } from '../lib/prisma';
import { resolveProjectSettingsById } from '../lib/projectSettings';
import { isProjectManager } from '../lib/projectRoles';
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
/** L'auteur de la version posée par `given` — celui qui vient de livrer. */
const author = { id: 9, role: Role.ARTIST };

/** Une ligne d'assignation telle que le service la relit. */
const row = (id: number, name: string, note: string | null = null) => ({ note, reviewer: person(id, name) });

/** Réglage du projet : rien n'est exigé, sauf mention contraire dans le test. */
const rule = (requireNote = false, minNoteLength = 5) =>
  vi
    .mocked(resolveProjectSettingsById)
    .mockResolvedValue({ reviewRequest: { requireNote, minNoteLength } } as never);

/**
 * Version vivante, état d'AVANT, puis liste relue APRÈS l'écriture.
 *
 * `…Once` sur les deux lectures : la première sert à décider qui prévenir, la seconde est
 * la liste rendue. Les confondre ferait passer une consigne réécrite pour inchangée.
 */
function given(before: { reviewerId: number; note: string | null }[], after: ReturnType<typeof row>[]) {
  vi.mocked(prisma.version.findFirst).mockResolvedValue({
    id: 42,
    name: 'V03',
    taskId: 7,
    assetId: null,
    authorId: author.id,
  } as never);
  vi.mocked(prisma.reviewAssignment.findMany)
    .mockResolvedValueOnce(before as never)
    .mockResolvedValueOnce(after as never);
  vi.mocked(prisma.mediaObject.findFirst).mockResolvedValue({ id: 500 } as never);
}

const assignable = (ids: number[]) =>
  vi
    .mocked(prisma.user.findMany)
    .mockResolvedValue(
      ids.map((id) => ({ id, role: Role.ARTIST, isService: false, disabledAt: null })) as never,
    );

/**
 * `clearAllMocks` efface les appels mais garde les valeurs posées avec `…Once` : un test
 * qui échoue avant d'avoir consommé les siennes les léguerait au suivant.
 */
function resetDb() {
  vi.clearAllMocks();
  for (const fn of [
    prisma.version.findFirst,
    prisma.mediaObject.findFirst,
    prisma.user.findMany,
    prisma.reviewAssignment.findMany,
    prisma.reviewAssignment.findUnique,
  ])
    vi.mocked(fn).mockReset();
  vi.mocked(isProjectManager).mockResolvedValue(true);
  rule();
}

beforeEach(resetDb);

describe('listReviewers', () => {
  it('rend les personnes confiées, photo signée et consigne', async () => {
    vi.mocked(prisma.reviewAssignment.findMany).mockResolvedValue([
      { note: 'la lumière', reviewer: { ...person(4, 'alice'), avatarKey: 'a.png' } },
    ] as never);
    await expect(listReviewers(42)).resolves.toEqual([
      expect.objectContaining({ id: 4, name: 'alice', avatarUrl: 'url:a.png', note: 'la lumière' }),
    ]);
  });
});

describe('setReviewers', () => {
  it('remplace la liste, audite, émet, notifie et abonne les nouveaux', async () => {
    given([{ reviewerId: 4, note: null }], [row(4, 'alice'), row(5, 'bruno', 'le raccord')]);
    assignable([4, 5]);

    const out = await setReviewers(supervisor, 3, 42, [{ userId: 4 }, { userId: 5, note: 'le raccord' }]);

    expect(out.map((p) => p.id)).toEqual([4, 5]);
    expect(prisma.reviewAssignment.deleteMany).toHaveBeenCalledWith({
      where: { versionId: 42, reviewerId: { notIn: [4, 5] } },
    });
    expect(prisma.reviewAssignment.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ reviewerId: 5, note: 'le raccord' }) }),
    );
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'version.reviewers', entityId: 42 }),
    );
    expect(emitToProject).toHaveBeenCalledWith(3, 'version:update', expect.objectContaining({ id: 42 }));
    // Seul le nouveau venu est prévenu : Alice y était déjà, et rien n'a changé pour elle.
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 5,
        kind: 'reviewAssigned',
        messageKey: 'notification.reviewAssigned',
        params: { version: 'V03' },
        projectId: 3,
        // Le premier média de la version : c'est ce qui rend la notification navigable.
        referenceId: 500,
      }),
    );
    expect(setWatch).toHaveBeenCalledWith(5, WatchTargetType.VERSION, 42, true);
  });

  it('nettoie l’espace de bordure — sans quoi cinq espaces passeraient un plancher de cinq', async () => {
    given([], [row(4, 'alice', 'la lumière')]);
    assignable([4]);
    await setReviewers(supervisor, 3, 42, [{ userId: 4, note: '  la lumière  ' }]);
    expect(prisma.reviewAssignment.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ note: 'la lumière' }) }),
    );
  });

  it('signale une consigne réécrite, sans réabonner la personne', async () => {
    given([{ reviewerId: 4, note: 'la lumière' }], [row(4, 'alice', 'le raccord')]);
    assignable([4]);
    await setReviewers(supervisor, 3, 42, [{ userId: 4, note: 'le raccord' }]);
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 4, messageKey: 'notification.reviewNoteUpdated' }),
    );
    // Se désabonner appartient au reviewer : une consigne réécrite ne le lui reprend pas.
    expect(setWatch).not.toHaveBeenCalled();
  });

  it('ne réveille personne quand la même liste est réenregistrée', async () => {
    given([{ reviewerId: 4, note: 'la lumière' }], [row(4, 'alice', 'la lumière')]);
    assignable([4]);
    await setReviewers(supervisor, 3, 42, [{ userId: 4, note: 'la lumière' }]);
    expect(notify).not.toHaveBeenCalled();
  });

  it('ne se notifie pas soi-même', async () => {
    given([], [row(1, 'sup')]);
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: 1, role: Role.SUPERVISOR, isService: false, disabledAt: null },
    ] as never);
    await setReviewers(supervisor, 3, 42, [{ userId: 1 }]);
    expect(notify).not.toHaveBeenCalled();
  });

  it('retirer quelqu’un n’avertit personne', async () => {
    given(
      [
        { reviewerId: 4, note: null },
        { reviewerId: 5, note: null },
      ],
      [row(4, 'alice')],
    );
    assignable([4]);
    await setReviewers(supervisor, 3, 42, [{ userId: 4 }]);
    expect(notify).not.toHaveBeenCalled();
  });

  it('refuse un client et un compte de service, sans rien écrire', async () => {
    given([], []);
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: 6, role: Role.CLIENT, isService: false, disabledAt: null },
    ] as never);
    await expect(setReviewers(supervisor, 3, 42, [{ userId: 6 }])).rejects.toMatchObject({
      statusCode: 400,
    });

    resetDb();
    given([], []);
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: 7, role: Role.ARTIST, isService: true, disabledAt: null },
    ] as never);
    await expect(setReviewers(supervisor, 3, 42, [{ userId: 7 }])).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(prisma.reviewAssignment.upsert).not.toHaveBeenCalled();
  });

  it('dédoublonne la liste reçue — la dernière consigne gagne', async () => {
    given([], [row(4, 'alice', 'le raccord')]);
    assignable([4]);
    await setReviewers(supervisor, 3, 42, [
      { userId: 4, note: 'la lumière' },
      { userId: 4, note: 'le raccord' },
    ]);
    expect(prisma.reviewAssignment.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.reviewAssignment.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ note: 'le raccord' }) }),
    );
  });

  it('404 sur une version inconnue', async () => {
    vi.mocked(prisma.version.findFirst).mockResolvedValue(null);
    await expect(setReviewers(supervisor, 3, 999, [{ userId: 4 }])).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(prisma.reviewAssignment.upsert).not.toHaveBeenCalled();
  });

  describe('règle de consigne du projet', () => {
    it('refuse une assignation sans consigne quand le projet l’exige', async () => {
      given([], []);
      assignable([4]);
      rule(true);
      await expect(setReviewers(supervisor, 3, 42, [{ userId: 4 }])).rejects.toMatchObject({
        code: 'REVIEW_NOTE_REQUIRED',
      });
      expect(prisma.reviewAssignment.upsert).not.toHaveBeenCalled();
    });

    it('refuse une consigne plus courte que le plancher', async () => {
      given([], []);
      assignable([4]);
      rule(true, 10);
      await expect(setReviewers(supervisor, 3, 42, [{ userId: 4, note: 'ok' }])).rejects.toMatchObject({
        code: 'REVIEW_NOTE_TOO_SHORT',
      });
    });

    it('applique le plancher même à une consigne facultative', async () => {
      given([], []);
      assignable([4]);
      rule(false, 10);
      await expect(setReviewers(supervisor, 3, 42, [{ userId: 4, note: 'ok' }])).rejects.toMatchObject({
        code: 'REVIEW_NOTE_TOO_SHORT',
      });
    });
  });

  describe('qui peut confier', () => {
    it('laisse l’auteur de la version désigner ses ReViewers', async () => {
      given([], [row(4, 'alice', 'la lumière')]);
      assignable([4]);
      vi.mocked(isProjectManager).mockResolvedValue(false);
      await expect(setReviewers(author, 3, 42, [{ userId: 4, note: 'la lumière' }])).resolves.toBeDefined();
    });

    it('refuse quelqu’un qui n’est ni l’auteur ni gestionnaire du projet', async () => {
      given([], []);
      assignable([4]);
      vi.mocked(isProjectManager).mockResolvedValue(false);
      await expect(setReviewers({ id: 77, role: Role.ARTIST }, 3, 42, [{ userId: 4 }])).rejects.toMatchObject(
        { statusCode: 403 },
      );
      expect(prisma.reviewAssignment.upsert).not.toHaveBeenCalled();
    });
  });
});

describe('updateNote', () => {
  beforeEach(() => {
    vi.mocked(prisma.version.findFirst).mockResolvedValue({
      id: 42,
      name: 'V03',
      taskId: 7,
      assetId: null,
      authorId: author.id,
    } as never);
    vi.mocked(prisma.reviewAssignment.findUnique).mockResolvedValue({ note: 'la lumière' } as never);
    vi.mocked(prisma.reviewAssignment.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.mediaObject.findFirst).mockResolvedValue({ id: 500 } as never);
  });

  it('réécrit la consigne et prévient la personne', async () => {
    await updateNote(supervisor, 3, 42, 4, 'le raccord au 1042');
    expect(prisma.reviewAssignment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ note: 'le raccord au 1042' }) }),
    );
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 4, messageKey: 'notification.reviewNoteUpdated' }),
    );
    // La liste n'a pas changé : l'audit ne doit pas faire croire le contraire.
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'version.reviewer_note', entityId: 42 }),
    );
  });

  it('n’écrit rien — et ne notifie rien — quand la consigne est identique', async () => {
    await updateNote(supervisor, 3, 42, 4, 'la lumière');
    expect(prisma.reviewAssignment.update).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it('efface la consigne quand le projet ne l’exige pas', async () => {
    await updateNote(supervisor, 3, 42, 4, '   ');
    expect(prisma.reviewAssignment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ note: null }) }),
    );
  });

  it('refuse de l’effacer quand le projet l’exige', async () => {
    rule(true);
    await expect(updateNote(supervisor, 3, 42, 4, '   ')).rejects.toMatchObject({
      code: 'REVIEW_NOTE_REQUIRED',
    });
  });

  it('refuse de réécrire la consigne de quelqu’un qui n’est pas confié', async () => {
    vi.mocked(prisma.reviewAssignment.findUnique).mockResolvedValue(null);
    await expect(updateNote(supervisor, 3, 42, 4, 'le raccord')).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});

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
    // `checkReviewNote` IS the rule: mocking it would only test the mock.
  ...(await importOriginal<typeof import('../lib/projectSettings')>()),
  resolveProjectSettingsById: vi.fn(),
}));
vi.mock('./SocketService', () => ({ emitToProject: vi.fn() }));
vi.mock('./AuditService', () => ({ logAudit: vi.fn() }));
vi.mock('./NotificationService', () => ({ notify: vi.fn() }));
vi.mock('./WatchService', () => ({ setWatch: vi.fn() }));
vi.mock('./ApiEventService', () => ({ publish: vi.fn() }));
// The photo is signed by the service: the test checks the rendered shape, not the signature.
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
/** The author of the version set by `given`: the artist who has just delivered it. */
const author = { id: 9, role: Role.ARTIST };

/** An assignment row, as the service reads it back. */
const row = (id: number, name: string, note: string | null = null) => ({ note, reviewer: person(id, name) });

/** Project setting: nothing is required, unless the test says otherwise. */
const rule = (requireNote = false, minNoteLength = 5) =>
  vi
    .mocked(resolveProjectSettingsById)
    .mockResolvedValue({ reviewRequest: { requireNote, minNoteLength } } as never);

/**
 * Live version: the state BEFORE, then the list re-read AFTER the write.
 *
 * `…Once` on both reads: the first decides whom to notify, the second is the rendered list.
 * Confusing them would make a rewritten instruction look unchanged.
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
 * `clearAllMocks` clears calls but keeps values set with `…Once`: a test that fails before
 * consuming its own would leak them to the next one.
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
  it('returns the assigned people, signed photo and instruction', async () => {
    vi.mocked(prisma.reviewAssignment.findMany).mockResolvedValue([
      { note: 'la lumière', reviewer: { ...person(4, 'alice'), avatarKey: 'a.png' } },
    ] as never);
    await expect(listReviewers(42)).resolves.toEqual([
      expect.objectContaining({ id: 4, name: 'alice', avatarUrl: 'url:a.png', note: 'la lumière' }),
    ]);
  });
});

describe('setReviewers', () => {
  it('replaces the list, audits, emits, notifies and subscribes newcomers', async () => {
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
        // Only the newcomer is notified: Alice was already assigned and nothing changed for her.
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 5,
        kind: 'reviewAssigned',
        messageKey: 'notification.reviewAssigned',
        params: { version: 'V03' },
        projectId: 3,
                // The version's first media: this is what makes the notification navigable.
        referenceId: 500,
      }),
    );
    expect(setWatch).toHaveBeenCalledWith(5, WatchTargetType.VERSION, 42, true);
  });

  it('trims edge whitespace, otherwise five spaces would pass a minimum of five', async () => {
    given([], [row(4, 'alice', 'la lumière')]);
    assignable([4]);
    await setReviewers(supervisor, 3, 42, [{ userId: 4, note: '  la lumière  ' }]);
    expect(prisma.reviewAssignment.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ note: 'la lumière' }) }),
    );
  });

  it('flags a rewritten instruction, without resubscribing the person', async () => {
    given([{ reviewerId: 4, note: 'la lumière' }], [row(4, 'alice', 'le raccord')]);
    assignable([4]);
    await setReviewers(supervisor, 3, 42, [{ userId: 4, note: 'le raccord' }]);
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 4, messageKey: 'notification.reviewNoteUpdated' }),
    );
        // Unsubscribing belongs to the reviewer: a rewritten instruction does not take it back.
    expect(setWatch).not.toHaveBeenCalled();
  });

  it('does not wake anyone when the same list is saved again', async () => {
    given([{ reviewerId: 4, note: 'la lumière' }], [row(4, 'alice', 'la lumière')]);
    assignable([4]);
    await setReviewers(supervisor, 3, 42, [{ userId: 4, note: 'la lumière' }]);
    expect(notify).not.toHaveBeenCalled();
  });

  it('does not notify oneself', async () => {
    given([], [row(1, 'sup')]);
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: 1, role: Role.SUPERVISOR, isService: false, disabledAt: null },
    ] as never);
    await setReviewers(supervisor, 3, 42, [{ userId: 1 }]);
    expect(notify).not.toHaveBeenCalled();
  });

  it('removing someone notifies nobody', async () => {
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

  it('refuses a client and a service account, without writing anything', async () => {
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

  it('de-duplicates the received list; the last instruction wins', async () => {
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

  it('404 on an unknown version', async () => {
    vi.mocked(prisma.version.findFirst).mockResolvedValue(null);
    await expect(setReviewers(supervisor, 3, 999, [{ userId: 4 }])).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(prisma.reviewAssignment.upsert).not.toHaveBeenCalled();
  });

  describe('project instruction rule', () => {
    it('refuses an assignment without instruction when the project requires one', async () => {
      given([], []);
      assignable([4]);
      rule(true);
      await expect(setReviewers(supervisor, 3, 42, [{ userId: 4 }])).rejects.toMatchObject({
        code: 'REVIEW_NOTE_REQUIRED',
      });
      expect(prisma.reviewAssignment.upsert).not.toHaveBeenCalled();
    });

    it('refuses an instruction shorter than the minimum', async () => {
      given([], []);
      assignable([4]);
      rule(true, 10);
      await expect(setReviewers(supervisor, 3, 42, [{ userId: 4, note: 'ok' }])).rejects.toMatchObject({
        code: 'REVIEW_NOTE_TOO_SHORT',
      });
    });

    it('applies the minimum even to an optional instruction', async () => {
      given([], []);
      assignable([4]);
      rule(false, 10);
      await expect(setReviewers(supervisor, 3, 42, [{ userId: 4, note: 'ok' }])).rejects.toMatchObject({
        code: 'REVIEW_NOTE_TOO_SHORT',
      });
    });
  });

  describe('who can assign', () => {
    it('lets the version author assign its ReViewers', async () => {
      given([], [row(4, 'alice', 'la lumière')]);
      assignable([4]);
      vi.mocked(isProjectManager).mockResolvedValue(false);
      await expect(setReviewers(author, 3, 42, [{ userId: 4, note: 'la lumière' }])).resolves.toBeDefined();
    });

    it('refuses someone who is neither the author nor a project manager', async () => {
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

  it('rewrites the instruction and notifies the person', async () => {
    await updateNote(supervisor, 3, 42, 4, 'le raccord au 1042');
    expect(prisma.reviewAssignment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ note: 'le raccord au 1042' }) }),
    );
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 4, messageKey: 'notification.reviewNoteUpdated' }),
    );
        // The list did not change: the audit must not suggest otherwise.
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'version.reviewer_note', entityId: 42 }),
    );
  });

  it('writes nothing, and notifies nothing, when the instruction is identical', async () => {
    await updateNote(supervisor, 3, 42, 4, 'la lumière');
    expect(prisma.reviewAssignment.update).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it('clears the instruction when the project does not require one', async () => {
    await updateNote(supervisor, 3, 42, 4, '   ');
    expect(prisma.reviewAssignment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ note: null }) }),
    );
  });

  it('refuses to clear it when the project requires one', async () => {
    rule(true);
    await expect(updateNote(supervisor, 3, 42, 4, '   ')).rejects.toMatchObject({
      code: 'REVIEW_NOTE_REQUIRED',
    });
  });

  it('refuses to rewrite the instruction of someone who is not assigned', async () => {
    vi.mocked(prisma.reviewAssignment.findUnique).mockResolvedValue(null);
    await expect(updateNote(supervisor, 3, 42, 4, 'le raccord')).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});

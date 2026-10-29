// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/prisma', () => ({
  prisma: {
    comment: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    reaction: { upsert: vi.fn(), delete: vi.fn() },
    projectMembership: { findMany: vi.fn() },
    // Shot targeted by a feedback (46): its project is checked against that of the route.
    timeline: { findUnique: vi.fn() },
    // Project writable by default (38.B): the archiving lock queries project.findFirst.
    project: { findFirst: vi.fn().mockResolvedValue({ status: 'ACTIVE' }) },
  },
}));
vi.mock('./SocketService', () => ({ emitToProject: vi.fn() }));
vi.mock('./NotificationService', () => ({ notify: vi.fn(), sendDiscord: vi.fn() }));
vi.mock('./ReviewReferenceService', () => ({ purgeForComment: vi.fn() }));
vi.mock('./WatchService', () => ({ notifyWatchers: vi.fn().mockResolvedValue([]) }));
// Assignment: the real guard queries the database; we replace it to observe ITS calls.
vi.mock('./EntityAssigneeService', async (importOriginal) => ({
  // The module also exports `ASSIGNEE_SELECT`, which other services re-read at import time: replacing the
  // whole module would break their loading. Only the guard is swapped.
  ...(await importOriginal<typeof import('./EntityAssigneeService')>()),
  assertAssignable: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../lib/storage', () => ({
  storage: {
    getPresignedGetUrl: vi.fn().mockResolvedValue('https://minio/url'),
    getPresignedPutUrl: vi.fn().mockResolvedValue('https://minio/put'),
    deleteObjects: vi.fn().mockResolvedValue([]),
  },
}));
vi.mock('../lib/userView', () => ({
  toPublicUser: vi.fn(async (u: unknown) => u),
  // Same contract as the real one: an external name erases the author instead of fabricating one.
  toPublicUserOrDeleted: vi.fn(
    async (u: unknown, externalName?: string | null) =>
      u ?? (externalName ? null : { displayName: 'Compte supprimé' }),
  ),
}));

import {
  create,
  extractMentionTokens,
  listMontage,
  listThread,
  publicAttachments,
  remove,
  resolutionOf,
  share,
  update,
} from './CommentService';
import { prisma } from '../lib/prisma';
import { storage } from '../lib/storage';
import { notify } from './NotificationService';
import { notifyWatchers } from './WatchService';
import { assertAssignable } from './EntityAssigneeService';
import { Role } from '@prisma/client';

const author = { id: 5, role: Role.ARTIST };
const other = { id: 6, role: Role.ARTIST };
const supervisor = { id: 2, role: Role.SUPERVISOR };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.comment.findUnique).mockResolvedValue({ userId: author.id } as never);
  vi.mocked(prisma.comment.update).mockResolvedValue({ id: 1, author: { id: 5 }, mediaObjectId: 9 } as never);
  // By default, the cited edit belongs to project 3 — the one the route authorized.
  vi.mocked(prisma.timeline.findUnique).mockResolvedValue({ projectId: 3 } as never);
});

describe('extractMentionTokens (32.B)', () => {
  it('extracts the @tokens, de-duplicated and lowercased', () => {
    expect(extractMentionTokens('@Yvig regarde avec @jean.dupont et @yvig')).toEqual(['yvig', 'jean.dupont']);
  });
  it('ignores emails and @ signs glued to a word', () => {
    expect(extractMentionTokens('contact y@x.fr svp')).toEqual([]);
  });
});

describe('create: mentions (32.B)', () => {
  const members = [
    { user: { id: 5, username: 'auteur', email: 'auteur@s.fr' } },
    { user: { id: 7, username: 'Yvig', email: 'y@s.fr' } },
    { user: { id: 8, username: null, email: 'jean.dupont@s.fr' } },
  ];

  beforeEach(() => {
    vi.mocked(prisma.projectMembership.findMany).mockResolvedValue(members as never);
  });

  it('notifies mentioned members (username case-insensitive, email local part)', async () => {
    vi.mocked(prisma.comment.create).mockResolvedValue({
      id: 20,
      content: 'vu avec @yvig et @jean.dupont',
      author: { id: 5 },
    } as never);
    await create(author, 3, { mediaObjectId: 9, content: 'vu avec @yvig et @jean.dupont' });
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ userId: 7, kind: 'mention' }));
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ userId: 8, kind: 'mention' }));
  });

  it('never notifies the author, even when self-mentioned', async () => {
    vi.mocked(prisma.comment.create).mockResolvedValue({
      id: 21,
      content: 'note pour @auteur',
      author: { id: 5 },
    } as never);
    await create(author, 3, { mediaObjectId: 9, content: 'note pour @auteur' });
    expect(notify).not.toHaveBeenCalled();
  });

  it('reply: the mentioned parent does not receive a duplicate REPLY', async () => {
    vi.mocked(prisma.comment.findUnique).mockResolvedValue({ mediaObjectId: 9, userId: 7 } as never);
    vi.mocked(prisma.comment.create).mockResolvedValue({
      id: 22,
      content: 'oui @yvig',
      author: { id: 5 },
    } as never);
    await create(author, 3, { mediaObjectId: 9, content: 'oui @yvig', parentId: 4 });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ userId: 7, kind: 'mention' }));
  });
});

describe('create: attachments: keys bound to the author', () => {
  beforeEach(() => {
    vi.mocked(prisma.projectMembership.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.comment.create).mockResolvedValue({ id: 30, content: 'x', author: { id: 5 } } as never);
  });

  /** Keys actually persisted by the last `comment.create`. */
  const persistedAttachments = () =>
    (vi.mocked(prisma.comment.create).mock.calls.at(-1)?.[0] as { data: { attachments?: unknown } }).data
      .attachments as { key: string }[] | undefined;

  it("keeps the attachments from the author's own folder", async () => {
    await create(author, 3, {
      mediaObjectId: 9,
      content: 'planche',
      attachments: [{ key: `comments/attachments/${author.id}/1700-planche.png` }],
    });
    expect(persistedAttachments()).toHaveLength(1);
  });

  // The key is supplied by the client and later used to sign a read URL: accepting another user's folder
  // would let them read their attachment, on another project.
  it("discards a key located in another user's folder", async () => {
    await create(author, 3, {
      mediaObjectId: 9,
      content: 'exfil',
      attachments: [{ key: `comments/attachments/${other.id}/1700-confidentiel.png` }],
    });
    expect(persistedAttachments()).toBeUndefined();
  });

  it('discards any key outside the attachments folder', async () => {
    await create(author, 3, {
      mediaObjectId: 9,
      content: 'exfil',
      attachments: [
        { key: 'media/12/source.exr' },
        { key: 'studio/logo.png' },
        { key: `comments/attachments/${author.id}/../${other.id}/x.png` },
      ],
    });
    expect(persistedAttachments()).toBeUndefined();
  });
});

/**
 * A1-02: the route only authorizes the MEDIA's project. `timelineId` arrives from the same request body and
 * designated any edit of the studio — sequential identifiers, hence guessable. An ARTIST thus wrote into the
 * edit notes of a neighbouring project, under their own name, while reading the same notes gets them a 403.
 */
describe('create: cited edit: per-project scoping (A1-02)', () => {
  beforeEach(() => {
    vi.mocked(prisma.projectMembership.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.comment.create).mockResolvedValue({ id: 50, content: 'x', author: { id: 5 } } as never);
  });

  it('refuses an edit belonging to another project, writing nothing', async () => {
    vi.mocked(prisma.timeline.findUnique).mockResolvedValue({ projectId: 2 } as never);
    await expect(
      create(author, 7, { mediaObjectId: 34, content: 'coucou', timelineId: 2, timelineTime: 1 }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.comment.create).not.toHaveBeenCalled();
  });

  it('refuses a nonexistent edit', async () => {
    vi.mocked(prisma.timeline.findUnique).mockResolvedValue(null);
    await expect(
      create(author, 7, { mediaObjectId: 34, content: 'coucou', timelineId: 99999 }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.comment.create).not.toHaveBeenCalled();
  });

  // A position in the film without a film designates nothing: an orphan value, never read back.
  it('refuses an edit position without an edit', async () => {
    await expect(
      create(author, 3, { mediaObjectId: 9, content: 'coucou', timelineTime: 71.5 }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.comment.create).not.toHaveBeenCalled();
  });

  it('accepts the edit of the authorized project', async () => {
    vi.mocked(prisma.timeline.findUnique).mockResolvedValue({ projectId: 7 } as never);
    await create(author, 7, { mediaObjectId: 34, content: 'coupe', timelineId: 12, timelineTime: 4 });
    expect(prisma.comment.create).toHaveBeenCalled();
  });
});

/**
 * A2-04: `annotation` and `cameraState` were declared `z.any()`. The service now re-reads them itself: not
 * every input goes through `routes/comments.routes.ts`.
 */
describe('create: bounded JSON blobs (A2-04)', () => {
  beforeEach(() => {
    vi.mocked(prisma.projectMembership.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.comment.create).mockResolvedValue({ id: 51, content: 'x', author: { id: 5 } } as never);
  });

  it('refuses a free-form annotation', async () => {
    await expect(
      create(author, 3, { mediaObjectId: 9, content: 'x', annotation: { pad: 'A'.repeat(100) } }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.comment.create).not.toHaveBeenCalled();
  });

  it('refuses a camera pose carrying an unknown field', async () => {
    await expect(
      create(author, 3, {
        mediaObjectId: 9,
        content: 'x',
        cameraState: { position: { x: 0, y: 0, z: 1 }, target: { x: 0, y: 0, z: 0 }, pad: 'A'.repeat(100) },
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.comment.create).not.toHaveBeenCalled();
  });

  it('lets a legitimate annotation and pose through', async () => {
    await create(author, 3, {
      mediaObjectId: 9,
      content: 'x',
      annotation: [{ type: 'rect', id: 'a1', color: '#ef4444', width: 3, x: 0.1, y: 0.2, w: 0.3, h: 0.4 }],
      cameraState: { position: { x: 1, y: 2, z: 3 }, target: { x: 0, y: 0, z: 0 }, fov: 45 },
    });
    expect(prisma.comment.create).toHaveBeenCalled();
  });
});

describe('update: resolution trace (32.A)', () => {
  it('resolution: sets resolvedById and resolvedAt', async () => {
    await update(supervisor, 3, 1, { isResolved: true });
    expect(prisma.comment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          isResolved: true,
          resolvedById: supervisor.id,
          resolvedAt: expect.any(Date),
        }),
      }),
    );
  });

  it('reopening: clears the trace', async () => {
    await update(author, 3, 1, { isResolved: false });
    expect(prisma.comment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ isResolved: false, resolvedById: null, resolvedAt: null }),
      }),
    );
  });

  it('refuses resolution to a third party who is not a manager', async () => {
    await expect(update(other, 3, 1, { isResolved: true })).rejects.toMatchObject({ statusCode: 403 });
    expect(prisma.comment.update).not.toHaveBeenCalled();
  });

  it('editing the content is reserved to the author (isEdited set)', async () => {
    await expect(update(supervisor, 3, 1, { content: 'hop' })).rejects.toMatchObject({ statusCode: 403 });
    await update(author, 3, 1, { content: 'hop' });
    expect(prisma.comment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isEdited: true }) }),
    );
  });
});

describe('edit feedback (Phase 46)', () => {
  beforeEach(() => {
    vi.mocked(prisma.projectMembership.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.comment.create).mockResolvedValue({
      id: 40,
      content: 'coupe',
      author: { id: 5 },
    } as never);
  });

  /** Data actually persisted by the last `comment.create`. */
  const persisted = () =>
    (vi.mocked(prisma.comment.create).mock.calls.at(-1)?.[0] as { data: Record<string, unknown> }).data;

  it('keeps both scales: the frame within the shot, the position within the film', async () => {
    await create(author, 3, {
      mediaObjectId: 9,
      content: 'coupe trop longue',
      timestamp: 2.5,
      timelineId: 7,
      timelineTime: 71.5,
    });
    expect(persisted()).toMatchObject({
      mediaObjectId: 9,
      timestamp: 2.5,
      timelineId: 7,
      timelineTime: 71.5,
    });
  });

  // The feedback is not yet in the shot's review: alerting its followers would send them to look for
  // something they would not find there.
  it("does not alert the shot's followers while the feedback stays on the edit", async () => {
    await create(author, 3, { mediaObjectId: 9, content: 'note de coupe', timelineId: 7, timelineTime: 3 });
    expect(notifyWatchers).not.toHaveBeenCalled();
  });

  it('alerts the followers for an ordinary review comment', async () => {
    await create(author, 3, { mediaObjectId: 9, content: 'retour classique' });
    expect(notifyWatchers).toHaveBeenCalled();
  });

  it("the shot's thread hides edit feedback that has not been sent back", async () => {
    vi.mocked(prisma.comment.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.comment.count).mockResolvedValue(0);
    await listThread(9, { page: 1, pageSize: 20, order: 'desc' });
    const where = (vi.mocked(prisma.comment.findMany).mock.calls.at(-1)?.[0] as { where: unknown }).where;
    expect(where).toMatchObject({
      mediaObjectId: 9,
      OR: [{ timelineId: null }, { sharedToShot: true }],
    });
  });

  /**
   * Public sharing, search and export already bounded a CLIENT to the notes meant for them; reading the
   * thread inside the application did not — a client who was a project member therefore read all internal
   * notes, replies included.
   */
  it('a CLIENT receives only the notes meant for them, replies included', async () => {
    vi.mocked(prisma.comment.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.comment.count).mockResolvedValue(0);
    await listThread(9, { page: 1, pageSize: 20, order: 'desc' }, Role.CLIENT);
    const args = vi.mocked(prisma.comment.findMany).mock.calls.at(-1)?.[0] as {
      where: Record<string, unknown>;
      include: { replies: { where: Record<string, unknown> } };
    };
    expect(args.where).toMatchObject({ isVisibleToClient: true });
    expect(args.include.replies.where).toMatchObject({ isVisibleToClient: true });
    const countWhere = (vi.mocked(prisma.comment.count).mock.calls.at(-1)?.[0] as { where: unknown }).where;
    expect(countWhere).toMatchObject({ isVisibleToClient: true });
  });

  it('an ARTIST receives the whole thread', async () => {
    vi.mocked(prisma.comment.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.comment.count).mockResolvedValue(0);
    await listThread(9, { page: 1, pageSize: 20, order: 'desc' }, Role.ARTIST);
    const where = (vi.mocked(prisma.comment.findMany).mock.calls.at(-1)?.[0] as { where: unknown })
      .where as Record<string, unknown>;
    expect(where.isVisibleToClient).toBeUndefined();
  });

  it("the edit's thread is ordered by position within the film", async () => {
    vi.mocked(prisma.comment.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.comment.count).mockResolvedValue(0);
    await listMontage(7, { page: 1, pageSize: 20, order: 'desc' });
    const args = vi.mocked(prisma.comment.findMany).mock.calls.at(-1)?.[0] as {
      where: unknown;
      orderBy: unknown;
    };
    expect(args.where).toMatchObject({ timelineId: 7, parentId: null });
    expect(args.orderBy).toEqual([{ timelineTime: 'asc' }, { createdAt: 'asc' }]);
  });

  it('sending back to the review lifts the curtain without touching the timecode', async () => {
    vi.mocked(prisma.comment.findUnique).mockResolvedValue({
      userId: author.id,
      timelineId: 7,
      mediaObjectId: 9,
      sharedToShot: false,
    } as never);
    await share(author, 3, 1);
    const data = (
      vi.mocked(prisma.comment.update).mock.calls.at(-1)?.[0] as { data: Record<string, unknown> }
    ).data;
    expect(data).toEqual({ sharedToShot: true });
    expect(notifyWatchers).toHaveBeenCalled();
  });

  it('refuses to send back a comment that was not born on an edit', async () => {
    vi.mocked(prisma.comment.findUnique).mockResolvedValue({
      userId: author.id,
      timelineId: null,
      mediaObjectId: 9,
      sharedToShot: false,
    } as never);
    await expect(share(author, 3, 1)).rejects.toMatchObject({ statusCode: 400 });
  });

  it('refuses the sending-back to a third party who is not a manager', async () => {
    vi.mocked(prisma.comment.findUnique).mockResolvedValue({
      userId: author.id,
      timelineId: 7,
      mediaObjectId: 9,
      sharedToShot: false,
    } as never);
    await expect(share(other, 3, 1)).rejects.toMatchObject({ statusCode: 403 });
    await expect(share(supervisor, 3, 1)).resolves.toBeTruthy();
  });
});

describe('resolutionOf (D1)', () => {
  it('derives the boolean from the state: a resolved thread must not remain counted as open', () => {
    expect(resolutionOf('RESOLVED', undefined)).toEqual({ state: 'RESOLVED', isResolved: true });
    expect(resolutionOf('WIP', undefined)).toEqual({ state: 'WIP', isResolved: false });
    expect(resolutionOf('WONT_FIX', undefined)).toEqual({ state: 'WONT_FIX', isResolved: false });
  });

  it('derives the state from the boolean, for the v1 API and older clients', () => {
    expect(resolutionOf(undefined, true)).toEqual({ state: 'RESOLVED', isResolved: true });
    expect(resolutionOf(undefined, false)).toEqual({ state: 'OPEN', isResolved: false });
  });

  it('leaves the state intact when neither is sent', () => {
    expect(resolutionOf(undefined, undefined)).toEqual({});
  });

  it('takes precedence over the state when both arrive: it is the one the screen drives', () => {
    expect(resolutionOf('OPEN', true)).toEqual({ state: 'OPEN', isResolved: false });
  });
});

/**
 * D5: edit a comment's attachments.
 *
 * The `PATCH` ignored `attachments`: one could neither add nor remove an image while correcting its text. The
 * ownership guard of `create` must be reproduced identically, with an explicit tolerance for the folder of
 * notes coming from ShotGrid — otherwise a simple correction would erase the attachments fetched from the
 * remote site.
 */
describe('update: editable attachments (D5)', () => {
  const mine = `comments/attachments/${author.id}/1700-a.png`;
  const theirs = `comments/attachments/${other.id}/1700-secret.png`;
  const fromShotgrid = 'comments/attachments/shotgrid/1/9-note.png';

  /** Attachments actually persisted by the last `comment.update`. */
  const persisted = () =>
    (vi.mocked(prisma.comment.update).mock.calls.at(-1)?.[0] as { data: { attachments?: unknown } }).data
      .attachments as { key: string }[] | undefined;

  it('writes the supplied list and marks the comment as edited', async () => {
    await update(author, 3, 1, { attachments: [{ key: mine, name: 'a.png' }] });
    expect(persisted()).toEqual([{ key: mine, name: 'a.png' }]);
    expect(
      (vi.mocked(prisma.comment.update).mock.calls.at(-1)?.[0] as { data: { isEdited?: boolean } }).data
        .isEdited,
    ).toBe(true);
  });

  it('refuses editing the attachments to a manager who is not the author', async () => {
    await expect(update(supervisor, 3, 1, { attachments: [] })).rejects.toMatchObject({ statusCode: 403 });
    expect(prisma.comment.update).not.toHaveBeenCalled();
  });

  it("discards another user's key slipped into the edit", async () => {
    await update(author, 3, 1, { attachments: [{ key: theirs }, { key: mine }] });
    expect(persisted()).toEqual([{ key: mine }]);
  });

  it('keeps the ShotGrid attachment of the edited comment', async () => {
    await update(author, 3, 1, { attachments: [{ key: fromShotgrid }] });
    expect(persisted()).toEqual([{ key: fromShotgrid }]);
  });

  it('refuses the ShotGrid folder of ANOTHER comment', async () => {
    await update(author, 3, 1, { attachments: [{ key: 'comments/attachments/shotgrid/2/9-note.png' }] });
    expect(persisted()).toEqual([]);
  });

  it('erases from storage the object that the edit removed', async () => {
    vi.mocked(prisma.comment.findUnique).mockResolvedValue({
      userId: author.id,
      attachments: [{ key: mine }, { key: fromShotgrid }],
    } as never);
    await update(author, 3, 1, { attachments: [{ key: fromShotgrid }] });
    expect(storage.deleteObjects).toHaveBeenCalledWith([mine]);
  });

  it('does not touch storage for any other edit', async () => {
    vi.mocked(prisma.comment.findUnique).mockResolvedValue({
      userId: author.id,
      attachments: [{ key: mine }],
    } as never);
    await update(author, 3, 1, { content: 'texte seul' });
    expect(storage.deleteObjects).not.toHaveBeenCalled();
  });
});

/**
 * CP-SEC phase 50: assigning a note to someone on the project, and to no one else.
 *
 * `assigneeId` comes from the client and was checked against nothing: a manager could entrust a note to any
 * account in the database — foreign to the project, disabled, or a service account — which then received the
 * notification. Tasks, entities and reviews all go through `assertAssignable`; comments had forgotten it.
 */
describe('update: assignment bounded to the project (CP-SEC 50)', () => {
  it('checks the assignee against the project before writing', async () => {
    await update(supervisor, 3, 1, { assigneeId: 42 });
    expect(assertAssignable).toHaveBeenCalledWith(3, [42]);
  });

  it('writes nothing when the person cannot be assigned on this project', async () => {
    vi.mocked(assertAssignable).mockRejectedValueOnce(new Error('NOT_ASSIGNABLE'));
    await expect(update(supervisor, 3, 1, { assigneeId: 42 })).rejects.toThrow('NOT_ASSIGNABLE');
    expect(prisma.comment.update).not.toHaveBeenCalled();
  });

  it('lets an assignment removal pass without querying the guard', async () => {
    await update(supervisor, 3, 1, { assigneeId: null });
    expect(assertAssignable).not.toHaveBeenCalled();
  });
});

/**
 * Deleting a comment used to leave its attachments in MinIO indefinitely — including those of its replies,
 * which go in cascade on the database side and were not picked up anywhere.
 */
describe('remove: storage purge', () => {
  beforeEach(() => {
    vi.mocked(prisma.comment.findUnique).mockResolvedValue({
      userId: author.id,
      attachments: [{ key: 'comments/attachments/5/1-a.png' }],
    } as never);
    vi.mocked(prisma.comment.findMany).mockResolvedValue([
      { attachments: [{ key: 'comments/attachments/5/2-b.png' }] },
    ] as never);
  });

  it('erases the files of the comment AND of its replies', async () => {
    expect(await remove(author, 3, 1)).toBe(true);
    expect(storage.deleteObjects).toHaveBeenCalledWith([
      'comments/attachments/5/1-a.png',
      'comments/attachments/5/2-b.png',
    ]);
  });

  it('erases nothing before the row has gone', async () => {
    const order: string[] = [];
    vi.mocked(prisma.comment.delete).mockImplementation(() => {
      order.push('delete');
      return Promise.resolve({}) as never;
    });
    vi.mocked(storage.deleteObjects).mockImplementation(() => {
      order.push('storage');
      return Promise.resolve([]);
    });
    await remove(author, 3, 1);
    expect(order).toEqual(['delete', 'storage']);
  });

  it('lets the deletion succeed if storage refuses', async () => {
    vi.mocked(storage.deleteObjects).mockRejectedValueOnce(new Error('minio down'));
    await expect(remove(author, 3, 1)).resolves.toBe(true);
  });
});

/**
 * Client portal: the images attached by the studio were invisible there. They are now returned, but the MinIO
 * key never comes down to a public surface — it would be used to sign others.
 */
describe('publicAttachments: public surface', () => {
  it('returns a presigned URL without the key', async () => {
    const out = await publicAttachments([
      { key: 'comments/attachments/5/1-a.png', name: 'a.png', contentType: 'image/png' },
    ]);
    expect(out).toEqual([{ name: 'a.png', contentType: 'image/png', url: 'https://minio/url' }]);
    expect(JSON.stringify(out)).not.toContain('comments/attachments');
  });

  it('returns an empty list when the comment attached nothing', async () => {
    expect(await publicAttachments(null)).toEqual([]);
  });
});

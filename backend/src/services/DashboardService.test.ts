// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/prisma', () => ({
  prisma: {
    $queryRaw: vi.fn(),
    comment: { findMany: vi.fn(), count: vi.fn(), groupBy: vi.fn() },
    version: { findMany: vi.fn() },
    mediaObject: { findMany: vi.fn(), count: vi.fn() },
    task: { findMany: vi.fn(), count: vi.fn() },
    project: { count: vi.fn(), findMany: vi.fn() },
  },
}));
vi.mock('./StorageService', () => ({
  storage: { getPresignedGetUrl: vi.fn(async (k: string) => `https://minio/${k}`) },
}));
// The home page shows the same image as elsewhere: the project's thumbnail, otherwise that of its first
// published media. The grouped election is tested in `lib/thumbnails`.
vi.mock('../lib/thumbnails', () => ({
  effectiveThumbnailUrl: vi.fn(async (key: string | null, fallback: string | null) => {
    const chosen = key ?? fallback;
    return chosen ? `https://minio/${chosen}` : null;
  }),
  firstMediaThumbKeysForProjects: vi.fn(async () => new Map<number, string>()),
}));

import { getDashboard } from './DashboardService';
import { prisma } from '../lib/prisma';
import { firstMediaThumbKeysForProjects } from '../lib/thumbnails';
import { Role, TaskStatus } from '@prisma/client';

const comments = vi.mocked(prisma.comment.findMany);
const versions = vi.mocked(prisma.version.findMany);
const media = vi.mocked(prisma.mediaObject.findMany);
const tasks = vi.mocked(prisma.task.findMany);
const queryRaw = vi.mocked(prisma.$queryRaw);

const artist = { id: 3, role: Role.ARTIST };

/**
 * `comment.groupBy` is used twice on the home page: the SQL election of the six most recently commented media
 * (call carrying `_max`), then the count of notes per media. The stub answers one or the other depending on
 * the shape of the call.
 */
function stubGroupBy(latest: unknown[] = [], counts: unknown[] = []) {
  vi.mocked(prisma.comment.groupBy).mockImplementation(((args: { _max?: unknown }) =>
    Promise.resolve(args._max ? latest : counts)) as never);
}

/** The election call (the one carrying `_max`), as the service set it up. */
function electionCall(): { by: unknown; take: unknown; orderBy: unknown; where: unknown } {
  const call = vi
    .mocked(prisma.comment.groupBy)
    .mock.calls.find((c) => typeof c[0] === 'object' && c[0] !== null && '_max' in c[0]);
  if (!call) throw new Error('aucune élection SQL des derniers commentaires');
  return call[0] as { by: unknown; take: unknown; orderBy: unknown; where: unknown };
}

/** A note as the second read returns it (displayed columns only). */
const noteSur9 = (content: string, id: number, createdAt: Date) => ({
  id,
  mediaObjectId: 9,
  content,
  timestamp: 4.2,
  createdAt,
  guestName: null,
  author: { id: 2, name: 'Ana' },
  media: {
    id: 9,
    kind: 'VIDEO',
    originalName: 'sh010_comp.mov',
    thumbnailKey: 'thumbs/9.jpg',
    version: {
      name: 'V02',
      task: { id: 4, name: 'Compositing', shot: { code: 'SH010', sequence: { code: 'SQ01' } } },
      asset: null,
    },
  },
});

function stubEmpty() {
  comments.mockResolvedValue([] as never);
  versions.mockResolvedValue([] as never);
  media.mockResolvedValue([] as never);
  tasks.mockResolvedValue([] as never);
  queryRaw.mockResolvedValue([] as never);
  vi.mocked(prisma.project.count).mockResolvedValue(2);
  vi.mocked(prisma.project.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.mediaObject.count).mockResolvedValue(5);
  // Media in review (5), 7-day window (1), then what is expected of me (4) — the order of the getDashboard
  // calls. "Awaiting my review" became a count of media: it is `ReviewAssignment` that decides, not the tasks
  // waiting for the whole studio.
  vi.mocked(prisma.mediaObject.count)
    .mockResolvedValueOnce(5)
    .mockResolvedValueOnce(1)
    .mockResolvedValueOnce(4);
  vi.mocked(prisma.comment.count).mockResolvedValue(11);
  vi.mocked(prisma.comment.count).mockResolvedValueOnce(11).mockResolvedValueOnce(3);
  stubGroupBy();
  // A single `task.count` now: my retakes.
  vi.mocked(prisma.task.count).mockResolvedValueOnce(1);
}

describe('DashboardService.getDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubEmpty();
  });

  it('bounds the queries to the member\'s projects (membership filter for an ARTIST)', async () => {
    await getDashboard(artist);
    const projectWhere = vi.mocked(prisma.project.count).mock.calls[0]![0]!.where;
    expect(projectWhere).toEqual({ deletedAt: null, memberships: { some: { userId: 3 } } });
  });

  it('does not filter by membership for an ADMIN', async () => {
    await getDashboard({ id: 1, role: Role.ADMIN });
    const projectWhere = vi.mocked(prisma.project.count).mock.calls[0]![0]!.where;
    expect(projectWhere).toEqual({ deletedAt: null });
  });

  it('returns the aggregated stats, 7-day trends and personal counters included', async () => {
    const { stats } = await getDashboard(artist);
    expect(stats).toEqual({
      projects: 2,
      mediaInReview: 5,
      comments: 11,
      mediaInReview7d: 1,
      comments7d: 3,
      myRetakes: 1,
      awaitingMyReview: 4,
    });
  });

  it('computes the progress of recent projects (approved tasks / total)', async () => {
    vi.mocked(prisma.project.findMany).mockResolvedValue([
      { id: 7, name: 'Dock', thumbnailKey: 'thumbs/p7.jpg' },
    ] as never);
    // A single aggregate replaces the two `count` per project: 6 approved out of 10.
    queryRaw.mockResolvedValue([
      {
        projectId: 7,
        status: TaskStatus.APPROVED,
        isDone: null,
        isInactive: null,
        legacyStatus: null,
        count: 6,
      },
      { projectId: 7, status: TaskStatus.TODO, isDone: null, isInactive: null, legacyStatus: null, count: 4 },
    ] as never);
    const { recentProjects } = await getDashboard(artist);
    expect(recentProjects).toEqual([
      { id: 7, name: 'Dock', thumbnailUrl: 'https://minio/thumbs/p7.jpg', totalTasks: 10, approvedTasks: 6 },
    ]);
  });

  it('shows the first media of the project when no thumbnail has been chosen', async () => {
    // The home page stuck to `thumbnailKey`: a project full of delivered work stayed without an image,
    // whereas its card carried one in the project list.
    vi.mocked(prisma.project.findMany).mockResolvedValue([
      { id: 7, name: 'Dock', thumbnailKey: null },
    ] as never);
    vi.mocked(firstMediaThumbKeysForProjects).mockResolvedValue(new Map([[7, 'derived/9/thumb.webp']]));
    const { recentProjects } = await getDashboard(artist);
    expect(recentProjects[0]!.thumbnailUrl).toBe('https://minio/derived/9/thumb.webp');
  });

  it('no longer issues two counts per recent project: a single aggregate, five projects', async () => {
    vi.mocked(prisma.project.findMany).mockResolvedValue(
      Array.from({ length: 5 }, (_, i) => ({ id: i + 1, name: `P${i}`, thumbnailKey: null })) as never,
    );
    await getDashboard(artist);
    // A single `task.count` in total (my retakes) — no more per project. "Awaiting my review" now counts
    // entrusted media, not tasks.
    expect(vi.mocked(prisma.task.count)).toHaveBeenCalledTimes(1);
    expect(queryRaw).toHaveBeenCalledTimes(1);
    // The five identifiers travel as parameters of the same aggregate.
    expect(JSON.stringify(queryRaw.mock.calls[0]!.slice(1))).toContain('5');
  });

  it('does not query the database when no recent project is to be displayed', async () => {
    await getDashboard(artist);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('reads the studio\'s reference: terminal counts as done, inactive does not count', async () => {
    vi.mocked(prisma.project.findMany).mockResolvedValue([
      { id: 7, name: 'Dock', thumbnailKey: null },
    ] as never);
    queryRaw.mockResolvedValue([
      // "fin": terminal on the site side, the local enum still says IN_PROGRESS.
      {
        projectId: 7,
        status: TaskStatus.IN_PROGRESS,
        isDone: true,
        isInactive: false,
        legacyStatus: TaskStatus.APPROVED,
        count: 3,
      },
      // "omt": omitted — outside any gauge, neither in the numerator nor in the denominator.
      {
        projectId: 7,
        status: TaskStatus.REJECTED,
        isDone: false,
        isInactive: true,
        legacyStatus: TaskStatus.REJECTED,
        count: 5,
      },
      {
        projectId: 7,
        status: TaskStatus.TODO,
        isDone: false,
        isInactive: false,
        legacyStatus: TaskStatus.TODO,
        count: 1,
      },
    ] as never);
    const { recentProjects } = await getDashboard(artist);
    expect(recentProjects[0]).toMatchObject({ totalTasks: 4, approvedTasks: 3 });
  });

  it('excludes from "my tasks" and from the counters what the studio regards as done or inactive', async () => {
    await getDashboard(artist);
    const myTasksWhere = JSON.stringify(tasks.mock.calls[0]![0]!.where);
    expect(myTasksWhere).toContain('"isDone":false');
    expect(myTasksWhere).toContain('"isInactive":false');
    for (const call of vi.mocked(prisma.task.count).mock.calls) {
      expect(JSON.stringify(call[0]!.where)).toContain('"isInactive":false');
    }
  });

  /**
   * The four counters each lied in their own way (the detail of each scope is verified in
   * `lib/homeScope.test.ts`): this test verifies the wiring, that is, that the home page does set THESE
   * scopes and not the old ones.
   */
  it('counts what is expected of ME: reviews entrusted to me, decision not yet given', async () => {
    await getDashboard(artist);
    const counts = vi.mocked(prisma.mediaObject.count).mock.calls.map((c) => JSON.stringify(c[0]!.where));
    // The personal queue goes through ReviewAssignment, and through it alone.
    const personnel = counts.filter((w) => w.includes('"reviewerId":3'));
    expect(personnel).toHaveLength(1);
    // None of the media counters counts a version already decided.
    expect(counts.every((w) => w.includes('"reviewStatusId":null'))).toBe(true);
  });

  it('bounds "my retakes" to my live projects and their visible items', async () => {
    await getDashboard(artist);
    const where = JSON.stringify(vi.mocked(prisma.task.count).mock.calls[0]![0]!.where);
    expect(where).toContain('"assigneeId":3');
    expect(where).toContain('"memberships":{"some":{"userId":3}}');
    expect(where).toContain('"hiddenAt":null');
  });

  it('maps the latest reviews with presigned thumbnail and last comment', async () => {
    const posee = new Date('2026-07-12T10:00:00Z');
    stubGroupBy([{ mediaObjectId: 9, _max: { createdAt: posee } }]);
    comments.mockResolvedValue([noteSur9('À reprendre sur le raccord', 51, posee)] as never);
    const { latestReviews } = await getDashboard(artist);
    expect(latestReviews).toEqual([
      {
        mediaId: 9,
        kind: 'VIDEO',
        name: 'sh010_comp.mov',
        thumbnailUrl: 'https://minio/thumbs/9.jpg',
        location: 'SQ01 · SH010',
        versionName: 'V02',
        commentCount: 0,
        lastComment: {
          content: 'À reprendre sur le raccord',
          author: 'Ana',
          timestamp: 4.2,
          createdAt: new Date('2026-07-12T10:00:00Z'),
        },
      },
    ]);
  });

  /**
   * PERF-01. The original read combined `distinct: ['mediaObjectId']` and `take: 6`: Prisma 5 resolves the
   * `distinct` in memory, which neutralizes the `take` — the SQL went out without a `LIMIT`, and the whole
   * studio Comment table crossed the network for six rows. The election must therefore happen in the
   * database, and the following read must only target those six.
   */
  it('elects the six latest commented media in SQL, without fetching the Comment table', async () => {
    const posee = new Date('2026-07-12T10:00:00Z');
    stubGroupBy([{ mediaObjectId: 9, _max: { createdAt: posee } }]);
    comments.mockResolvedValue([noteSur9('note', 51, posee)] as never);
    await getDashboard(artist);
    const election = electionCall();
    expect(election.by).toEqual(['mediaObjectId']);
    expect(election.take).toBe(6);
    expect(election.orderBy).toEqual({ _max: { createdAt: 'desc' } });
    // The second read only fetches the elected notes, and no longer has a `distinct`.
    const lecture = comments.mock.calls[0]![0]!;
    expect(lecture.distinct).toBeUndefined();
    expect(JSON.stringify(lecture.where)).toContain('"mediaObjectId":9');
    // And never the heavy columns (annotation trace, 3D viewpoint, attachments).
    const colonnes = JSON.stringify(lecture.select);
    expect(colonnes).not.toContain('annotation');
    expect(colonnes).not.toContain('cameraState');
    expect(colonnes).not.toContain('attachments');
  });

  it('passes the access scope to both reads: a CLIENT remains bounded to their notes', async () => {
    const posee = new Date('2026-07-12T10:00:00Z');
    stubGroupBy([{ mediaObjectId: 9, _max: { createdAt: posee } }]);
    comments.mockResolvedValue([noteSur9('note visible', 51, posee)] as never);
    await getDashboard({ id: 8, role: Role.CLIENT });
    // The filter that bounds a client to the notes meant for them must be found IDENTICALLY in the election
    // AND in the read: losing it would be a leak.
    expect(JSON.stringify(electionCall().where)).toContain('"isVisibleToClient":true');
    const where = comments.mock.calls[0]![0]!.where as { AND: unknown[] };
    expect(JSON.stringify(where.AND[0])).toContain('"isVisibleToClient":true');
  });

  it('keeps only one note per media, the most recent — what the distinct used to do', async () => {
    const posee = new Date('2026-07-12T10:00:00Z');
    stubGroupBy([{ mediaObjectId: 9, _max: { createdAt: posee } }]);
    // Two notes of the same media at the same millisecond: the read returns both (descending sort, `id` as
    // tie-break), the home page shows only one.
    comments.mockResolvedValue([
      noteSur9('la retenue', 52, posee),
      noteSur9('la doublure', 51, posee),
    ] as never);
    const { latestReviews } = await getDashboard(artist);
    expect(latestReviews).toHaveLength(1);
    expect(latestReviews[0]!.lastComment.content).toBe('la retenue');
  });

  it('does not perform the second read when no media has a note', async () => {
    await getDashboard(artist);
    expect(comments).not.toHaveBeenCalled();
  });

  it('merges versions + media into the feed, sorted from most recent to oldest', async () => {
    versions.mockResolvedValue([
      {
        name: 'V03',
        createdAt: new Date('2026-07-12T08:00:00Z'),
        author: { id: 2, name: 'Ana' },
        task: { id: 4, name: 'Comp', shot: { code: 'SH010', sequence: null } },
        asset: null,
      },
    ] as never);
    media.mockResolvedValue([
      {
        id: 9,
        originalName: 'plan.mp4',
        createdAt: new Date('2026-07-12T09:00:00Z'),
        uploader: { id: 3, name: 'Bob' },
        version: { name: 'V01', task: null, asset: { name: 'Vaisseau' } },
      },
    ] as never);
    const { activity } = await getDashboard(artist);
    expect(activity.map((a) => a.type)).toEqual(['media', 'version']);
    expect(activity[0]).toMatchObject({ label: 'plan.mp4', location: 'Vaisseau', mediaId: 9 });
    expect(activity[1]).toMatchObject({ label: 'V03 — Comp', location: 'SH010', taskId: 4 });
  });

  it('sorts my tasks by status priority (RETAKE before TODO) and caps at 8', async () => {
    tasks.mockResolvedValue([
      ...Array.from({ length: 6 }, (_, i) => ({
        id: 10 + i,
        name: `t${i}`,
        type: 'OTHER',
        status: 'TODO',
        pipelineStatus: null,
        shot: { projectId: 1, code: 'SH001', sequence: null },
        asset: null,
      })),
      {
        id: 1,
        name: 'retake',
        type: 'FX',
        status: 'RETAKE',
        pipelineStatus: null,
        shot: null,
        asset: { projectId: 2, name: 'Robot' },
      },
      ...Array.from({ length: 4 }, (_, i) => ({
        id: 20 + i,
        name: `p${i}`,
        type: 'OTHER',
        status: 'PENDING_REVIEW',
        pipelineStatus: null,
        shot: { projectId: 1, code: 'SH002', sequence: null },
        asset: null,
      })),
    ] as never);
    const { myTasks } = await getDashboard(artist);
    expect(myTasks).toHaveLength(8);
    expect(myTasks[0]).toMatchObject({ id: 1, status: 'RETAKE', location: 'Robot', projectId: 2 });
    expect(myTasks.slice(1, 5).every((t) => t.status === 'PENDING_REVIEW')).toBe(true);
  });

  it('orders my tasks on the family of the custom status, not on the local enum', async () => {
    tasks.mockResolvedValue([
      {
        id: 10,
        name: 'à faire',
        type: 'OTHER',
        status: 'TODO',
        pipelineStatus: null,
        shot: { projectId: 1, code: 'SH001', sequence: null },
        asset: null,
      },
      {
        // Site "rtk" status: the local enum says IN_PROGRESS, the family says "blocked".
        id: 11,
        name: 'retake du site',
        type: 'OTHER',
        status: 'IN_PROGRESS',
        pipelineStatus: { isDone: false, isInactive: false, legacyStatus: 'RETAKE' },
        shot: { projectId: 1, code: 'SH002', sequence: null },
        asset: null,
      },
    ] as never);
    const { myTasks } = await getDashboard(artist);
    expect(myTasks.map((t) => t.id)).toEqual([11, 10]);
  });
});

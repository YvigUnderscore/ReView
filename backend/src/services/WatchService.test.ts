import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/prisma', () => ({
  prisma: {
    watch: { findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
    mediaObject: { findUnique: vi.fn() },
    version: { findUnique: vi.fn() },
  },
}));
vi.mock('./NotificationService', () => ({ notify: vi.fn() }));

import { setWatch, notifyWatchers } from './WatchService';
import { prisma } from '../lib/prisma';
import { notify } from './NotificationService';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('setWatch (32.G)', () => {
  it('active : upsert idempotent', async () => {
    await setWatch(1, 'SHOT', 7, true);
    expect(prisma.watch.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: { userId: 1, targetType: 'SHOT', targetId: 7 },
      }),
    );
  });
  it('désactive : deleteMany', async () => {
    await setWatch(1, 'SHOT', 7, false);
    expect(prisma.watch.deleteMany).toHaveBeenCalledWith({
      where: { userId: 1, targetType: 'SHOT', targetId: 7 },
    });
  });
});

describe('notifyWatchers (32.G)', () => {
  it('notifie les suiveurs de la chaîne du média, exclusions déduites', async () => {
    vi.mocked(prisma.mediaObject.findUnique).mockResolvedValue({
      versionId: 42,
      version: { assetId: null, task: { shotId: 7, assetId: null } },
    } as never);
    vi.mocked(prisma.watch.findMany).mockResolvedValue([
      { userId: 3 },
      { userId: 4 },
      { userId: 5 },
      { userId: 3 },
    ] as never);
    const out = await notifyWatchers({
      mediaObjectId: 9,
      projectId: 2,
      content: 'activité',
      exclude: [5],
    });
    expect(out.sort()).toEqual([3, 4]);
    expect(prisma.watch.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { targetType: 'VERSION', targetId: 42 },
            { targetType: 'SHOT', targetId: 7 },
          ],
        },
      }),
    );
    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 3, type: 'WATCH', referenceId: 9 }),
    );
  });

  it('chaîne par version (décision) : referenceId explicite conservé', async () => {
    vi.mocked(prisma.version.findUnique).mockResolvedValue({
      assetId: 12,
      task: null,
    } as never);
    vi.mocked(prisma.watch.findMany).mockResolvedValue([{ userId: 6 }] as never);
    await notifyWatchers({ versionId: 42, projectId: 2, content: 'décision', referenceId: 77 });
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ userId: 6, referenceId: 77 }));
  });

  it('média inconnu : personne à notifier', async () => {
    vi.mocked(prisma.mediaObject.findUnique).mockResolvedValue(null as never);
    const out = await notifyWatchers({ mediaObjectId: 999, projectId: 2, content: 'x' });
    expect(out).toEqual([]);
    expect(notify).not.toHaveBeenCalled();
  });
});

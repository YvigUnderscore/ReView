// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/prisma', () => ({
  prisma: {
    comment: { create: vi.fn(), findUnique: vi.fn() },
    projectMembership: { findMany: vi.fn().mockResolvedValue([]) },
    project: { findFirst: vi.fn().mockResolvedValue({ status: 'ACTIVE' }) },
  },
}));
vi.mock('./SocketService', () => ({ emitToProject: vi.fn() }));
vi.mock('./NotificationService', () => ({ notify: vi.fn(), sendDiscord: vi.fn() }));
vi.mock('./ReviewReferenceService', () => ({ purgeForComment: vi.fn() }));
vi.mock('./WatchService', () => ({ notifyWatchers: vi.fn().mockResolvedValue([]) }));
vi.mock('./ApiEventService', () => ({ publish: vi.fn() }));
vi.mock('./shotgrid/ShotgridPushService', () => ({ enqueuePush: vi.fn() }));
vi.mock('./StorageService', () => ({
  storage: { getPresignedGetUrl: vi.fn(), getPresignedPutUrl: vi.fn() },
}));
vi.mock('../lib/userView', () => ({
  toPublicUser: vi.fn(async (u: unknown) => u),
  toPublicUserOrDeleted: vi.fn(
    async (u: unknown, externalName?: string | null) =>
      u ?? (externalName ? null : { displayName: 'Deleted account' }),
  ),
}));

import { createGuest } from './CommentService';
import { prisma } from '../lib/prisma';
import { notify, sendDiscord } from './NotificationService';
import { notifyWatchers } from './WatchService';
import { publish } from './ApiEventService';
import { enqueuePush } from './shotgrid/ShotgridPushService';

/**
 * A client's feedback used to go through a bare `prisma.comment.create` followed by a single socket emit:
 * with nobody in front of the project at that moment, it was reported to no one. These tests cover both
 * halves of the problem: the alert chain must fire, and the guest must be able to do nothing more than leave
 * a feedback.
 */
const guest = { name: 'Camille (client)', shareLinkId: 4, shareOwnerId: 2 };
const body = { mediaObjectId: 9, content: 'Le raccord au plan suivant saute.', timestamp: 12.5 };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.comment.create).mockResolvedValue({
    id: 31,
    mediaObjectId: 9,
    guestName: guest.name,
    author: null,
  } as never);
  vi.mocked(notifyWatchers).mockResolvedValue([]);
});

describe('createGuest: a client\'s feedback reaches someone', () => {
  it('alerts the followers of the shot with the guest\'s name', async () => {
    await createGuest(guest, 7, body);
    expect(notifyWatchers).toHaveBeenCalledWith(
      expect.objectContaining({
        mediaObjectId: 9,
        projectId: 7,
        messageKey: 'notification.clientComment',
        params: { name: guest.name },
      }),
    );
  });

  // Followers are a voluntary subscription, often empty on a delivered shot: without this, the feedback may
  // reach no one even though someone asked for it.
  it('also alerts whoever created the link', async () => {
    await createGuest(guest, 7, body);
    expect(notify).toHaveBeenCalledWith(
      // Type `WATCH`: this is what points the notification to the media's review.
      expect.objectContaining({ userId: 2, kind: 'watch', referenceId: 9 }),
    );
  });

  it('does not duplicate the notification when the link creator already follows the shot', async () => {
    vi.mocked(notifyWatchers).mockResolvedValue([2]);
    await createGuest(guest, 7, body);
    expect(notify).not.toHaveBeenCalled();
  });

  it('publishes the API event with the borrowed link and no actor', async () => {
    await createGuest(guest, 7, body);
    expect(publish).toHaveBeenCalledWith(
      'comment.created',
      expect.objectContaining({
        projectId: 7,
        actorId: null,
        payload: expect.objectContaining({ guestName: guest.name, shareLinkId: 4, authorId: null }),
      }),
    );
  });

  it('pushes the note to ShotGrid and pings Discord', async () => {
    await createGuest(guest, 7, body);
    expect(enqueuePush).toHaveBeenCalledWith(7, { type: 'comment', commentId: 31, actorId: null });
    expect(sendDiscord).toHaveBeenCalled();
  });
});

describe('createGuest: what a guest cannot do', () => {
  it('writes a comment without an account, visible to the client, at the root', async () => {
    await createGuest(guest, 7, body);
    const data = vi.mocked(prisma.comment.create).mock.calls[0]?.[0]?.data as Record<string, unknown>;
    expect(data.guestName).toBe(guest.name);
    expect(data.userId).toBeUndefined();
    expect(data.parentId).toBeUndefined();
    expect(data.isVisibleToClient).toBe(true);
    expect(data.attachments).toBeUndefined();
    expect(data.annotation).toBeUndefined();
  });

  // A guest's `@name` must notify no one: the public page has no directory, and a stranger does not choose
  // whom the studio should wake.
  it('triggers no mention', async () => {
    await createGuest(guest, 7, { ...body, content: 'merci @alice et @bob' });
    expect(prisma.projectMembership.findMany).not.toHaveBeenCalled();
  });

  it('sanitizes the content', async () => {
    await createGuest(guest, 7, { ...body, content: '<script>alert(1)</script>ok' });
    const data = vi.mocked(prisma.comment.create).mock.calls[0]?.[0]?.data as { content: string };
    expect(data.content).not.toContain('<script>');
  });

  // 38.B: an archived project is read-only, including for links already distributed.
  it('refuses to write to an archived project', async () => {
    vi.mocked(prisma.project.findFirst).mockResolvedValueOnce({ status: 'ARCHIVED' } as never);
    await expect(createGuest(guest, 7, body)).rejects.toThrow();
    expect(prisma.comment.create).not.toHaveBeenCalled();
  });
});

/**
 * A2-02: `cameraState` was the only free-form field of the PUBLIC sharing surface: `z.any()` on the route
 * side, copied as is into the database, then rebroadcast to every socket of the project. Anyone holding the
 * link could therefore pour megabytes of arbitrary JSON into it, request after request, without any account.
 * The service now reads it back.
 */
describe('createGuest: a guest\'s camera pose is bounded (A2-02)', () => {
  it('refuses a free-form blob', async () => {
    await expect(
      createGuest(guest, 7, { ...body, cameraState: { p: 'A'.repeat(4_000) } }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.comment.create).not.toHaveBeenCalled();
  });

  it('refuses an augmented pose carrying an unknown field (volume would slip through there)', async () => {
    await expect(
      createGuest(guest, 7, {
        ...body,
        cameraState: {
          position: { x: 0, y: 0, z: 1 },
          target: { x: 0, y: 0, z: 0 },
          pad: 'A'.repeat(4_000),
        },
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.comment.create).not.toHaveBeenCalled();
  });

  it('accepts the pose the viewer actually captures', async () => {
    const pose = {
      position: { x: 1.5, y: 2, z: -3 },
      target: { x: 0, y: 0, z: 0 },
      fov: 45,
      aspect: 1.78,
      apertureAngle: 0.02,
      focalDistance: 4.2,
    };
    await createGuest(guest, 7, { ...body, cameraState: pose });
    const data = vi.mocked(prisma.comment.create).mock.calls[0]?.[0]?.data as Record<string, unknown>;
    expect(data.cameraState).toEqual(pose);
  });
});

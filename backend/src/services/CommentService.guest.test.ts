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
 * Le retour d'un client passait par un `prisma.comment.create` nu suivi d'un seul emit
 * socket : sans personne devant le projet à cet instant, il n'était signalé à personne.
 * Ces tests portent sur les deux moitiés du problème — la chaîne d'alerte doit se
 * déclencher, et l'invité ne doit rien pouvoir faire de plus que déposer un retour.
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

describe('createGuest — le retour d’un client atteint quelqu’un', () => {
  it('prévient les suiveurs du plan avec le nom de l’invité', async () => {
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

  // Les suiveurs sont un abonnement volontaire, souvent vide sur un plan livré : sans
  // cela, le retour peut n'atteindre personne alors que quelqu'un l'a sollicité.
  it('prévient aussi qui a créé le lien', async () => {
    await createGuest(guest, 7, body);
    expect(notify).toHaveBeenCalledWith(
      // Type `WATCH` : c'est lui qui fait pointer la notification vers la review du média.
      expect.objectContaining({ userId: 2, type: 'WATCH', referenceId: 9 }),
    );
  });

  it('ne double pas la notification quand le créateur du lien suit déjà le plan', async () => {
    vi.mocked(notifyWatchers).mockResolvedValue([2]);
    await createGuest(guest, 7, body);
    expect(notify).not.toHaveBeenCalled();
  });

  it('publie l’événement d’API avec le lien emprunté et sans acteur', async () => {
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

  it('pousse la note vers ShotGrid et ping Discord', async () => {
    await createGuest(guest, 7, body);
    expect(enqueuePush).toHaveBeenCalledWith(7, { type: 'comment', commentId: 31, actorId: null });
    expect(sendDiscord).toHaveBeenCalled();
  });
});

describe('createGuest — ce qu’un invité ne peut pas faire', () => {
  it('écrit un commentaire sans compte, visible du client, à la racine', async () => {
    await createGuest(guest, 7, body);
    const data = vi.mocked(prisma.comment.create).mock.calls[0]?.[0]?.data as Record<string, unknown>;
    expect(data.guestName).toBe(guest.name);
    expect(data.userId).toBeUndefined();
    expect(data.parentId).toBeUndefined();
    expect(data.isVisibleToClient).toBe(true);
    expect(data.attachments).toBeUndefined();
    expect(data.annotation).toBeUndefined();
  });

  // Le `@nom` d'un invité ne doit notifier personne : la page publique n'a pas d'annuaire,
  // et un inconnu ne choisit pas qui le studio doit réveiller.
  it('ne déclenche aucune mention', async () => {
    await createGuest(guest, 7, { ...body, content: 'merci @alice et @bob' });
    expect(prisma.projectMembership.findMany).not.toHaveBeenCalled();
  });

  it('assainit le contenu', async () => {
    await createGuest(guest, 7, { ...body, content: '<script>alert(1)</script>ok' });
    const data = vi.mocked(prisma.comment.create).mock.calls[0]?.[0]?.data as { content: string };
    expect(data.content).not.toContain('<script>');
  });

  // 38.B : un projet archivé est en lecture seule, y compris pour les liens déjà distribués.
  it('refuse d’écrire dans un projet archivé', async () => {
    vi.mocked(prisma.project.findFirst).mockResolvedValueOnce({ status: 'ARCHIVED' } as never);
    await expect(createGuest(guest, 7, body)).rejects.toThrow();
    expect(prisma.comment.create).not.toHaveBeenCalled();
  });
});

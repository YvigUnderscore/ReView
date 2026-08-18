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
    // Projet writable par défaut (38.B) : le verrou d’archivage interroge project.findFirst.
    project: { findFirst: vi.fn().mockResolvedValue({ status: 'ACTIVE' }) },
  },
}));
vi.mock('./SocketService', () => ({ emitToProject: vi.fn() }));
vi.mock('./NotificationService', () => ({ notify: vi.fn(), sendDiscord: vi.fn() }));
vi.mock('./ReviewReferenceService', () => ({ purgeForComment: vi.fn() }));
vi.mock('./WatchService', () => ({ notifyWatchers: vi.fn().mockResolvedValue([]) }));
vi.mock('./StorageService', () => ({
  storage: {
    getPresignedGetUrl: vi.fn().mockResolvedValue('https://minio/url'),
    getPresignedPutUrl: vi.fn().mockResolvedValue('https://minio/put'),
  },
}));
vi.mock('../lib/userView', () => ({
  toPublicUser: vi.fn(async (u: unknown) => u),
  // Même contrat que la vraie : un nom externe efface l'auteur au lieu d'en fabriquer un.
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
  resolutionOf,
  share,
  update,
} from './CommentService';
import { prisma } from '../lib/prisma';
import { notify } from './NotificationService';
import { notifyWatchers } from './WatchService';
import { Role } from '@prisma/client';

const author = { id: 5, role: Role.ARTIST };
const other = { id: 6, role: Role.ARTIST };
const supervisor = { id: 2, role: Role.SUPERVISOR };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.comment.findUnique).mockResolvedValue({ userId: author.id } as never);
  vi.mocked(prisma.comment.update).mockResolvedValue({ id: 1, author: { id: 5 }, mediaObjectId: 9 } as never);
});

describe('extractMentionTokens (32.B)', () => {
  it('extrait les @jetons dédoublonnés en minuscules', () => {
    expect(extractMentionTokens('@Yvig regarde avec @jean.dupont et @yvig')).toEqual(['yvig', 'jean.dupont']);
  });
  it('ignore les emails et les @ collés à un mot', () => {
    expect(extractMentionTokens('contact y@x.fr svp')).toEqual([]);
  });
});

describe('create — mentions (32.B)', () => {
  const members = [
    { user: { id: 5, username: 'auteur', email: 'auteur@s.fr' } },
    { user: { id: 7, username: 'Yvig', email: 'y@s.fr' } },
    { user: { id: 8, username: null, email: 'jean.dupont@s.fr' } },
  ];

  beforeEach(() => {
    vi.mocked(prisma.projectMembership.findMany).mockResolvedValue(members as never);
  });

  it('notifie les membres mentionnés (username insensible à la casse, email local)', async () => {
    vi.mocked(prisma.comment.create).mockResolvedValue({
      id: 20,
      content: 'vu avec @yvig et @jean.dupont',
      author: { id: 5 },
    } as never);
    await create(author, 3, { mediaObjectId: 9, content: 'vu avec @yvig et @jean.dupont' });
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ userId: 7, type: 'MENTION' }));
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ userId: 8, type: 'MENTION' }));
  });

  it('ne notifie jamais l’auteur, même auto-mentionné', async () => {
    vi.mocked(prisma.comment.create).mockResolvedValue({
      id: 21,
      content: 'note pour @auteur',
      author: { id: 5 },
    } as never);
    await create(author, 3, { mediaObjectId: 9, content: 'note pour @auteur' });
    expect(notify).not.toHaveBeenCalled();
  });

  it('réponse : le parent mentionné ne reçoit pas de REPLY en double', async () => {
    vi.mocked(prisma.comment.findUnique).mockResolvedValue({ mediaObjectId: 9, userId: 7 } as never);
    vi.mocked(prisma.comment.create).mockResolvedValue({
      id: 22,
      content: 'oui @yvig',
      author: { id: 5 },
    } as never);
    await create(author, 3, { mediaObjectId: 9, content: 'oui @yvig', parentId: 4 });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ userId: 7, type: 'MENTION' }));
  });
});

describe('create — pièces jointes : clés bornées à l’auteur', () => {
  beforeEach(() => {
    vi.mocked(prisma.projectMembership.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.comment.create).mockResolvedValue({ id: 30, content: 'x', author: { id: 5 } } as never);
  });

  /** Clés effectivement persistées par le dernier `comment.create`. */
  const persistedAttachments = () =>
    (vi.mocked(prisma.comment.create).mock.calls.at(-1)?.[0] as { data: { attachments?: unknown } }).data
      .attachments as { key: string }[] | undefined;

  it('conserve les pièces jointes du dossier de l’auteur', async () => {
    await create(author, 3, {
      mediaObjectId: 9,
      content: 'planche',
      attachments: [{ key: `comments/attachments/${author.id}/1700-planche.png` }],
    });
    expect(persistedAttachments()).toHaveLength(1);
  });

  // La clé est fournie par le client et sert ensuite à signer une URL de lecture : accepter
  // le dossier d'un autre utilisateur laisserait lire sa pièce jointe, sur un autre projet.
  it('écarte la clé située dans le dossier d’un autre utilisateur', async () => {
    await create(author, 3, {
      mediaObjectId: 9,
      content: 'exfil',
      attachments: [{ key: `comments/attachments/${other.id}/1700-confidentiel.png` }],
    });
    expect(persistedAttachments()).toBeUndefined();
  });

  it('écarte toute clé hors du dossier des pièces jointes', async () => {
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

describe('update — trace de résolution (32.A)', () => {
  it('résolution : renseigne resolvedById et resolvedAt', async () => {
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

  it('réouverture : efface la trace', async () => {
    await update(author, 3, 1, { isResolved: false });
    expect(prisma.comment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ isResolved: false, resolvedById: null, resolvedAt: null }),
      }),
    );
  });

  it('résolution refusée à un tiers non gestionnaire', async () => {
    await expect(update(other, 3, 1, { isResolved: true })).rejects.toMatchObject({ statusCode: 403 });
    expect(prisma.comment.update).not.toHaveBeenCalled();
  });

  it('édition du contenu réservée à l’auteur (isEdited posé)', async () => {
    await expect(update(supervisor, 3, 1, { content: 'hop' })).rejects.toMatchObject({ statusCode: 403 });
    await update(author, 3, 1, { content: 'hop' });
    expect(prisma.comment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isEdited: true }) }),
    );
  });
});

describe('retours de montage (Phase 46)', () => {
  beforeEach(() => {
    vi.mocked(prisma.projectMembership.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.comment.create).mockResolvedValue({
      id: 40,
      content: 'coupe',
      author: { id: 5 },
    } as never);
  });

  /** Données effectivement persistées par le dernier `comment.create`. */
  const persisted = () =>
    (vi.mocked(prisma.comment.create).mock.calls.at(-1)?.[0] as { data: Record<string, unknown> }).data;

  it('garde les deux échelles : la frame dans le plan, la position dans le film', async () => {
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

  // Le retour n'est pas encore dans la review du plan : prévenir ses suiveurs les enverrait
  // chercher quelque chose qu'ils n'y verraient pas.
  it('ne prévient pas les suiveurs du plan tant que le retour reste sur le montage', async () => {
    await create(author, 3, { mediaObjectId: 9, content: 'note de coupe', timelineId: 7, timelineTime: 3 });
    expect(notifyWatchers).not.toHaveBeenCalled();
  });

  it('prévient les suiveurs pour un commentaire de review ordinaire', async () => {
    await create(author, 3, { mediaObjectId: 9, content: 'retour classique' });
    expect(notifyWatchers).toHaveBeenCalled();
  });

  it('le fil d’un plan masque les retours de montage non renvoyés', async () => {
    vi.mocked(prisma.comment.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.comment.count).mockResolvedValue(0);
    await listThread(9, { page: 1, pageSize: 20, order: 'desc' });
    const where = (vi.mocked(prisma.comment.findMany).mock.calls.at(-1)?.[0] as { where: unknown }).where;
    expect(where).toMatchObject({
      mediaObjectId: 9,
      OR: [{ timelineId: null }, { sharedToShot: true }],
    });
  });

  it('le fil du montage est ordonné sur la position dans le film', async () => {
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

  it('renvoyer sur la review lève le rideau sans toucher au timecode', async () => {
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

  it('refuse de renvoyer un commentaire qui n’est pas né sur un montage', async () => {
    vi.mocked(prisma.comment.findUnique).mockResolvedValue({
      userId: author.id,
      timelineId: null,
      mediaObjectId: 9,
      sharedToShot: false,
    } as never);
    await expect(share(author, 3, 1)).rejects.toMatchObject({ statusCode: 400 });
  });

  it('refuse le renvoi à un tiers non gestionnaire', async () => {
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
  it('déduit le booléen de l’état — un fil résolu ne doit pas rester compté ouvert', () => {
    expect(resolutionOf('RESOLVED', undefined)).toEqual({ state: 'RESOLVED', isResolved: true });
    expect(resolutionOf('WIP', undefined)).toEqual({ state: 'WIP', isResolved: false });
    expect(resolutionOf('WONT_FIX', undefined)).toEqual({ state: 'WONT_FIX', isResolved: false });
  });

  it('déduit l’état du booléen, pour l’API v1 et les anciens clients', () => {
    expect(resolutionOf(undefined, true)).toEqual({ state: 'RESOLVED', isResolved: true });
    expect(resolutionOf(undefined, false)).toEqual({ state: 'OPEN', isResolved: false });
  });

  it('laisse l’état intact quand ni l’un ni l’autre n’est envoyé', () => {
    expect(resolutionOf(undefined, undefined)).toEqual({});
  });

  it('fait foi sur l’état quand les deux arrivent — c’est lui que l’écran pilote', () => {
    expect(resolutionOf('OPEN', true)).toEqual({ state: 'OPEN', isResolved: false });
  });
});

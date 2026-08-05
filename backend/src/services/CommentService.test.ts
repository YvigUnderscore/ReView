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
vi.mock('../lib/userView', () => ({ toPublicUser: vi.fn(async (u: unknown) => u) }));

import { create, extractMentionTokens, update } from './CommentService';
import { prisma } from '../lib/prisma';
import { notify } from './NotificationService';
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

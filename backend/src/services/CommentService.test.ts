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
    // Montage visé par un retour (46) : son projet est confronté à celui de la route.
    timeline: { findUnique: vi.fn() },
    // Projet writable par défaut (38.B) : le verrou d’archivage interroge project.findFirst.
    project: { findFirst: vi.fn().mockResolvedValue({ status: 'ACTIVE' }) },
  },
}));
vi.mock('./SocketService', () => ({ emitToProject: vi.fn() }));
vi.mock('./NotificationService', () => ({ notify: vi.fn(), sendDiscord: vi.fn() }));
vi.mock('./ReviewReferenceService', () => ({ purgeForComment: vi.fn() }));
vi.mock('./WatchService', () => ({ notifyWatchers: vi.fn().mockResolvedValue([]) }));
// Assignation : la vraie garde interroge la base ; on la remplace pour observer SES appels.
vi.mock('./EntityAssigneeService', async (importOriginal) => ({
  // Le module porte aussi `ASSIGNEE_SELECT`, que d'autres services relisent à l'import :
  // le remplacer en entier casserait leur chargement. On n'échange que la garde.
  ...(await importOriginal<typeof import('./EntityAssigneeService')>()),
  assertAssignable: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./StorageService', () => ({
  storage: {
    getPresignedGetUrl: vi.fn().mockResolvedValue('https://minio/url'),
    getPresignedPutUrl: vi.fn().mockResolvedValue('https://minio/put'),
    deleteObjects: vi.fn().mockResolvedValue([]),
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
  publicAttachments,
  remove,
  resolutionOf,
  share,
  update,
} from './CommentService';
import { prisma } from '../lib/prisma';
import { storage } from './StorageService';
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
  // Par défaut, le montage cité appartient au projet 3 — celui que la route a autorisé.
  vi.mocked(prisma.timeline.findUnique).mockResolvedValue({ projectId: 3 } as never);
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
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ userId: 7, kind: 'mention' }));
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ userId: 8, kind: 'mention' }));
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
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ userId: 7, kind: 'mention' }));
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

/**
 * A1-02 : la route n'autorise que le projet du MÉDIA. `timelineId` arrive du même corps de
 * requête et désignait, lui, n'importe quel montage du studio — identifiants séquentiels,
 * donc devinables. Un ARTIST écrivait ainsi dans les notes de montage d'un projet voisin,
 * sous son nom, alors que la lecture des mêmes notes lui répond 403.
 */
describe('create — montage cité : cloisonnement par projet (A1-02)', () => {
  beforeEach(() => {
    vi.mocked(prisma.projectMembership.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.comment.create).mockResolvedValue({ id: 50, content: 'x', author: { id: 5 } } as never);
  });

  it('refuse un montage appartenant à un autre projet, sans rien écrire', async () => {
    vi.mocked(prisma.timeline.findUnique).mockResolvedValue({ projectId: 2 } as never);
    await expect(
      create(author, 7, { mediaObjectId: 34, content: 'coucou', timelineId: 2, timelineTime: 1 }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.comment.create).not.toHaveBeenCalled();
  });

  it('refuse un montage inexistant', async () => {
    vi.mocked(prisma.timeline.findUnique).mockResolvedValue(null);
    await expect(
      create(author, 7, { mediaObjectId: 34, content: 'coucou', timelineId: 99999 }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.comment.create).not.toHaveBeenCalled();
  });

  // Une position dans le film sans film ne désigne rien : valeur orpheline, jamais relue.
  it('refuse une position de montage sans montage', async () => {
    await expect(
      create(author, 3, { mediaObjectId: 9, content: 'coucou', timelineTime: 71.5 }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.comment.create).not.toHaveBeenCalled();
  });

  it('accepte le montage du projet autorisé', async () => {
    vi.mocked(prisma.timeline.findUnique).mockResolvedValue({ projectId: 7 } as never);
    await create(author, 7, { mediaObjectId: 34, content: 'coupe', timelineId: 12, timelineTime: 4 });
    expect(prisma.comment.create).toHaveBeenCalled();
  });
});

/**
 * A2-04 : `annotation` et `cameraState` étaient déclarés `z.any()`. Le service les relit
 * désormais lui-même — toutes les entrées ne passent pas par `routes/comments.routes.ts`.
 */
describe('create — blobs JSON bornés (A2-04)', () => {
  beforeEach(() => {
    vi.mocked(prisma.projectMembership.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.comment.create).mockResolvedValue({ id: 51, content: 'x', author: { id: 5 } } as never);
  });

  it('refuse une annotation de forme libre', async () => {
    await expect(
      create(author, 3, { mediaObjectId: 9, content: 'x', annotation: { pad: 'A'.repeat(100) } }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.comment.create).not.toHaveBeenCalled();
  });

  it('refuse une pose caméra portant un champ inconnu', async () => {
    await expect(
      create(author, 3, {
        mediaObjectId: 9,
        content: 'x',
        cameraState: { position: { x: 0, y: 0, z: 1 }, target: { x: 0, y: 0, z: 0 }, pad: 'A'.repeat(100) },
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.comment.create).not.toHaveBeenCalled();
  });

  it('laisse passer une annotation et une pose légitimes', async () => {
    await create(author, 3, {
      mediaObjectId: 9,
      content: 'x',
      annotation: [{ type: 'rect', id: 'a1', color: '#ef4444', width: 3, x: 0.1, y: 0.2, w: 0.3, h: 0.4 }],
      cameraState: { position: { x: 1, y: 2, z: 3 }, target: { x: 0, y: 0, z: 0 }, fov: 45 },
    });
    expect(prisma.comment.create).toHaveBeenCalled();
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

  /**
   * Le partage public, la recherche et l'export bornaient déjà un CLIENT aux notes qui lui
   * sont destinées ; la lecture du fil dans l'application, non — un client membre du projet
   * y lisait donc toutes les notes internes, réponses comprises.
   */
  it('un CLIENT ne reçoit que les notes qui lui sont destinées, réponses comprises', async () => {
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

  it('un ARTIST reçoit le fil entier', async () => {
    vi.mocked(prisma.comment.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.comment.count).mockResolvedValue(0);
    await listThread(9, { page: 1, pageSize: 20, order: 'desc' }, Role.ARTIST);
    const where = (vi.mocked(prisma.comment.findMany).mock.calls.at(-1)?.[0] as { where: unknown })
      .where as Record<string, unknown>;
    expect(where.isVisibleToClient).toBeUndefined();
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

/**
 * D5 — éditer les pièces jointes d'un commentaire.
 *
 * Le `PATCH` ignorait `attachments` : on ne pouvait ni ajouter ni retirer une image en
 * corrigeant son texte. La garde de propriété de `create` doit être reproduite à
 * l'identique, avec une tolérance explicite pour le dossier des notes venues de ShotGrid —
 * sinon une simple correction effacerait les pièces rapatriées du site distant.
 */
describe('update — pièces jointes éditables (D5)', () => {
  const mine = `comments/attachments/${author.id}/1700-a.png`;
  const theirs = `comments/attachments/${other.id}/1700-secret.png`;
  const fromShotgrid = 'comments/attachments/shotgrid/1/9-note.png';

  /** Pièces jointes effectivement persistées par le dernier `comment.update`. */
  const persisted = () =>
    (vi.mocked(prisma.comment.update).mock.calls.at(-1)?.[0] as { data: { attachments?: unknown } }).data
      .attachments as { key: string }[] | undefined;

  it('écrit la liste fournie et marque le commentaire édité', async () => {
    await update(author, 3, 1, { attachments: [{ key: mine, name: 'a.png' }] });
    expect(persisted()).toEqual([{ key: mine, name: 'a.png' }]);
    expect(
      (vi.mocked(prisma.comment.update).mock.calls.at(-1)?.[0] as { data: { isEdited?: boolean } }).data
        .isEdited,
    ).toBe(true);
  });

  it('refuse l’édition des pièces jointes à un gestionnaire non auteur', async () => {
    await expect(update(supervisor, 3, 1, { attachments: [] })).rejects.toMatchObject({ statusCode: 403 });
    expect(prisma.comment.update).not.toHaveBeenCalled();
  });

  it('écarte la clé d’un autre utilisateur glissée dans l’édition', async () => {
    await update(author, 3, 1, { attachments: [{ key: theirs }, { key: mine }] });
    expect(persisted()).toEqual([{ key: mine }]);
  });

  it('conserve la pièce ShotGrid du commentaire édité', async () => {
    await update(author, 3, 1, { attachments: [{ key: fromShotgrid }] });
    expect(persisted()).toEqual([{ key: fromShotgrid }]);
  });

  it('refuse le dossier ShotGrid d’un AUTRE commentaire', async () => {
    await update(author, 3, 1, { attachments: [{ key: 'comments/attachments/shotgrid/2/9-note.png' }] });
    expect(persisted()).toEqual([]);
  });

  it('efface du stockage l’objet que l’édition a retiré', async () => {
    vi.mocked(prisma.comment.findUnique).mockResolvedValue({
      userId: author.id,
      attachments: [{ key: mine }, { key: fromShotgrid }],
    } as never);
    await update(author, 3, 1, { attachments: [{ key: fromShotgrid }] });
    expect(storage.deleteObjects).toHaveBeenCalledWith([mine]);
  });

  it('ne touche au stockage pour aucune autre édition', async () => {
    vi.mocked(prisma.comment.findUnique).mockResolvedValue({
      userId: author.id,
      attachments: [{ key: mine }],
    } as never);
    await update(author, 3, 1, { content: 'texte seul' });
    expect(storage.deleteObjects).not.toHaveBeenCalled();
  });
});

/**
 * CP-SEC phase 50 — assigner une note à quelqu'un du projet, et à personne d'autre.
 *
 * `assigneeId` arrive du client et n'était confronté à rien : un gestionnaire pouvait
 * confier une note à n'importe quel compte de la base — étranger au projet, désactivé, ou
 * de service —, qui en recevait la notification. Les tâches, les entités et les reviews
 * passent toutes par `assertAssignable` ; les commentaires l'oubliaient.
 */
describe('update — assignation bornée au projet (CP-SEC 50)', () => {
  it('confronte l’assigné au projet avant d’écrire', async () => {
    await update(supervisor, 3, 1, { assigneeId: 42 });
    expect(assertAssignable).toHaveBeenCalledWith(3, [42]);
  });

  it('n’écrit rien quand la personne n’est pas assignable sur ce projet', async () => {
    vi.mocked(assertAssignable).mockRejectedValueOnce(new Error('NOT_ASSIGNABLE'));
    await expect(update(supervisor, 3, 1, { assigneeId: 42 })).rejects.toThrow('NOT_ASSIGNABLE');
    expect(prisma.comment.update).not.toHaveBeenCalled();
  });

  it('laisse passer le retrait d’assignation sans interroger la garde', async () => {
    await update(supervisor, 3, 1, { assigneeId: null });
    expect(assertAssignable).not.toHaveBeenCalled();
  });
});

/**
 * Supprimer un commentaire laissait ses pièces jointes dans MinIO indéfiniment — y compris
 * celles de ses réponses, qui partent en cascade côté base et n'étaient relevées nulle part.
 */
describe('remove — purge du stockage', () => {
  beforeEach(() => {
    vi.mocked(prisma.comment.findUnique).mockResolvedValue({
      userId: author.id,
      attachments: [{ key: 'comments/attachments/5/1-a.png' }],
    } as never);
    vi.mocked(prisma.comment.findMany).mockResolvedValue([
      { attachments: [{ key: 'comments/attachments/5/2-b.png' }] },
    ] as never);
  });

  it('efface les pièces du commentaire ET de ses réponses', async () => {
    expect(await remove(author, 3, 1)).toBe(true);
    expect(storage.deleteObjects).toHaveBeenCalledWith([
      'comments/attachments/5/1-a.png',
      'comments/attachments/5/2-b.png',
    ]);
  });

  it('n’efface rien avant que la ligne ne soit partie', async () => {
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

  it('laisse la suppression réussir si le stockage refuse', async () => {
    vi.mocked(storage.deleteObjects).mockRejectedValueOnce(new Error('minio down'));
    await expect(remove(author, 3, 1)).resolves.toBe(true);
  });
});

/**
 * Portail client : les images jointes par le studio y étaient invisibles. On les rend, mais
 * la clé MinIO ne descend jamais sur une surface publique — elle servirait à en signer
 * d'autres.
 */
describe('publicAttachments — surface publique', () => {
  it('rend une URL présignée sans la clé', async () => {
    const out = await publicAttachments([
      { key: 'comments/attachments/5/1-a.png', name: 'a.png', contentType: 'image/png' },
    ]);
    expect(out).toEqual([{ name: 'a.png', contentType: 'image/png', url: 'https://minio/url' }]);
    expect(JSON.stringify(out)).not.toContain('comments/attachments');
  });

  it('rend une liste vide quand le commentaire n’a rien joint', async () => {
    expect(await publicAttachments(null)).toEqual([]);
  });
});

// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Request } from 'express';
import {
  Prisma,
  ShareScope,
  SharePermission,
  type MediaKind,
  type MediaObject,
  type ShareLink,
} from '@prisma/client';
import { prisma } from '../lib/prisma';
import { storage } from './StorageService';
import { imageTypeFromKey } from '../lib/uploadContentType';
import { shareState, verifyShareSession } from '../lib/shareAccess';
import { buildShareBrowse, type ShareBrowse } from './shareBrowse';
import { createGuest } from './CommentService';
import { decideAsGuest, guestStatuses } from './ReviewDecisionService';
import { logAudit } from './AuditService';
import { AppError, forbidden, notFound, unauthorized } from '../lib/errors';
import { SETTING_KEYS } from '../lib/settings';

/**
 * Accès public par lien de partage (35.C/35.D) — logique commune aux routes `/api/client`.
 * Principe : l'ouverture d'une session de partage (JWT court) consomme une vue ; les
 * sous-routes exigent cette session, la limite de vues ne peut donc pas être contournée.
 */

export const STUDIO_LOGO_KEY = SETTING_KEYS.STUDIO_LOGO;

/**
 * Plafond de médias servis par la page publique. Un lien de projet sur un long-métrage
 * renvoyait la table entière, sans `take` : plusieurs milliers de lignes et autant d'URLs
 * présignées de miniature, à chaque ouverture. Au-delà de ce plafond, la page annonce
 * `hasMore` — la réponse d'un lien qui montre trop est de le restreindre, pas de pagineer
 * un catalogue devant un client.
 */
export const SHARE_MEDIA_LIMIT = 200;

/**
 * Un plan, une séquence ou un asset masqué (`hiddenAt`, cf. `VisibilityRule`) : l'élément
 * existe, mais aucun écran interne ne le propose. Il n'avait aucune raison d'être proposé
 * au client non plus — et depuis que la page publique range les médias par entité, le
 * laisser passer ne montrerait plus seulement un nom de fichier mais le **nom et le code**
 * de ce qu'on a justement décidé de masquer.
 *
 * `omitted` (plan coupé au montage) n'est PAS filtré : ce n'est pas une règle de visibilité,
 * les écrans internes continuent de le montrer, et une livraison publiée reste une livraison.
 */
const VISIBLE = { deletedAt: null, hiddenAt: null };

/**
 * Médias visibles côté client : publiés, READY, version publiée, dans le projet partagé.
 * Les filtres `deletedAt: null` sont indispensables : la corbeille est un soft-delete, et
 * sans eux un plan mis à la corbeille reste listé — et téléchargeable — sur le lien public,
 * alors qu'il a disparu de l'interface interne.
 */
export const publishedMediaWhere = (projectId: number) => ({
  status: 'READY' as const,
  published: true,
  deletedAt: null,
  version: {
    published: true,
    deletedAt: null,
    OR: [
      // La séquence est facultative (un plan sans séquence est un cas normal) : on n'exige
      // sa visibilité que lorsqu'il y en a une, sinon le `OR` interne écarterait le plan.
      {
        task: {
          shot: {
            projectId,
            ...VISIBLE,
            OR: [{ sequenceId: null }, { sequence: VISIBLE }],
          },
        },
      },
      { task: { asset: { projectId, ...VISIBLE } } },
      { asset: { projectId, ...VISIBLE } },
    ],
  },
});

/** Ce qu'il faut savoir d'un lien pour décider ce qu'il ouvre. */
export interface ShareScopeRef {
  projectId: number;
  scope: ShareScope;
  playlistId: number | null;
  versionId: number | null;
  /** Sélection explicite (portée MEDIA) ; vide pour les autres portées. */
  mediaIds: number[];
}

/** Lien chargé, sa sélection de médias aplatie en identifiants. */
export type ShareRecord = ShareLink & { mediaIds: number[] };

/**
 * Filtre qui ne retient aucun média. Une portée dont la cible a disparu ne doit pas
 * retomber sur « tout le projet » : c'est exactement l'élargissement silencieux que la
 * portée existe pour empêcher.
 */
const MATCHES_NOTHING: Prisma.MediaObjectWhereInput = { id: { in: [] } };

/**
 * Ce que CE lien ouvre — à appliquer partout où le partage lit un média (liste, URL
 * présignée, fil de commentaires), et pas seulement à l'affichage de la liste : sinon un
 * client à qui l'on n'a montré qu'un plan télécharge les autres en devinant leur id.
 */
export function shareMediaWhere(share: ShareScopeRef): Prisma.MediaObjectWhereInput {
  const base = publishedMediaWhere(share.projectId);
  switch (share.scope) {
    case ShareScope.PLAYLIST:
      return share.playlistId == null
        ? MATCHES_NOTHING
        : {
            ...base,
            version: { ...base.version, playlistItems: { some: { playlistId: share.playlistId } } },
          };
    case ShareScope.VERSION:
      return share.versionId == null ? MATCHES_NOTHING : { ...base, versionId: share.versionId };
    case ShareScope.MEDIA:
      return share.mediaIds.length === 0 ? MATCHES_NOTHING : { ...base, id: { in: share.mediaIds } };
    case ShareScope.PROJECT:
    default:
      return base;
  }
}

/** Lien par token, ou 404 s'il est inconnu/révoqué/expiré (sans distinguer, anti-énumération). */
export async function loadShare(token: string): Promise<ShareRecord> {
  const share = await prisma.shareLink.findUnique({
    where: { token },
    include: { media: { select: { mediaObjectId: true } } },
  });
  if (!share) throw notFound('Invalid or expired link');
  const state = shareState(share);
  if (state === 'revoked' || state === 'expired') throw notFound('Invalid or expired link');
  const { media, ...rest } = share;
  return { ...rest, mediaIds: media.map((m) => m.mediaObjectId) };
}

/**
 * Sous-routes : lien valide + session de partage obligatoire (header `X-Share-Auth`).
 * Un lien épuisé reste lisible pour une session déjà ouverte (la vue est comptée).
 */
export async function loadShareWithSession(token: string, req: Request): Promise<ShareRecord> {
  const share = await loadShare(token);
  if (!verifyShareSession(req.header('x-share-auth') ?? undefined, share.id)) {
    throw unauthorized('A share session is required');
  }
  return share;
}

/**
 * Ce qu'il faut savoir d'un média pour le RANGER : sa version, et le chemin jusqu'à son
 * parent. Les trois branches sont exactement celles du `OR` de `publishedMediaWhere` — le
 * `select` les suit d'un coup plutôt que de relancer une requête par entité.
 */
const shareTreeSelect = {
  id: true,
  kind: true,
  originalName: true,
  thumbnailKey: true,
  createdAt: true,
  version: {
    select: {
      id: true,
      name: true,
      // Version posée DIRECTEMENT sur un asset, sans passer par une tâche.
      asset: { select: { id: true, name: true, type: true, typeLabel: true } },
      task: {
        select: {
          name: true,
          asset: { select: { id: true, name: true, type: true, typeLabel: true } },
          shot: {
            select: {
              id: true,
              code: true,
              name: true,
              order: true,
              sequence: {
                select: {
                  id: true,
                  code: true,
                  name: true,
                  order: true,
                  episode: { select: { id: true, code: true, name: true, order: true } },
                },
              },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.MediaObjectSelect;

type ShareMediaRow = Prisma.MediaObjectGetPayload<{ select: typeof shareTreeSelect }>;

/** Une tuile de la page publique, avec de quoi la situer. */
export interface ShareMediaTile {
  id: number;
  kind: MediaKind;
  originalName: string;
  thumbnailUrl: string | null;
  createdAt: string;
  version: { id: number; name: string; taskName: string | null };
  /** Ce lien s'est déjà prononcé sur cette version — la file d'accueil l'écarte. */
  decided: boolean;
  /** Où le média est rangé. Des clés, jamais des libellés : le rendu lit les nœuds. */
  placement: {
    episodeId: number | null;
    sequenceId: number | null;
    shotId: number | null;
    assetId: number | null;
  };
}

/**
 * Sur quelles versions CE lien s'est-il déjà prononcé ? C'est ce qui alimente la file
 * « en attente de votre retour » de l'accueil : un client qui revient doit retrouver où il
 * en était, et non recommencer à lire une grille du plus récent au plus ancien.
 */
async function decidedVersionIds(shareLinkId: number, versionIds: number[]): Promise<Set<number>> {
  if (versionIds.length === 0) return new Set();
  const rows = await prisma.reviewDecision.findMany({
    where: { shareLinkId, versionId: { in: versionIds } },
    select: { versionId: true },
    distinct: ['versionId'],
  });
  return new Set(rows.map((r) => r.versionId));
}

/** Rattachement d'une ligne, en identifiants seulement. */
function placementOf(row: ShareMediaRow): ShareMediaTile['placement'] {
  const shot = row.version.task?.shot ?? null;
  const asset = row.version.asset ?? row.version.task?.asset ?? null;
  return {
    episodeId: shot?.sequence?.episode?.id ?? null,
    sequenceId: shot?.sequence?.id ?? null,
    shotId: shot?.id ?? null,
    assetId: asset?.id ?? null,
  };
}

/**
 * Médias du lien, bornés, l'arborescence qui va avec, et de quoi dire au destinataire qu'il
 * n'a pas tout.
 *
 * **Un seul `findMany`** : même `where`, même `orderBy`, même `take` qu'avant — seul le
 * `select` s'est étoffé. L'arborescence est DÉRIVÉE de ces lignes, jamais requêtée depuis
 * `projectId` : c'est le seul mécanisme qui garantisse qu'un lien de portée MEDIA ne nomme
 * pas le plan voisin. Et une seule URL présignée par média, comme avant : les nœuds ne
 * portent qu'un `coverMediaId`, pas une vignette de plus à signer.
 */
export async function listShareMedia(
  share: ShareScopeRef,
  shareLinkId: number,
): Promise<{ media: ShareMediaTile[]; browse: ShareBrowse; total: number; hasMore: boolean }> {
  const where = shareMediaWhere(share);
  const [rows, total] = await Promise.all([
    prisma.mediaObject.findMany({
      where,
      // `id` départage : deux médias créés dans la même milliseconde (un import de lot)
      // s'échangeaient leur place d'un appel à l'autre.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: SHARE_MEDIA_LIMIT,
      select: shareTreeSelect,
    }),
    prisma.mediaObject.count({ where }),
  ]);
  const decided = await decidedVersionIds(shareLinkId, [...new Set(rows.map((m) => m.version.id))]);
  const media = await Promise.all(
    rows.map(async (m) => ({
      id: m.id,
      kind: m.kind,
      originalName: m.originalName,
      thumbnailUrl: m.thumbnailKey ? await storage.getPresignedGetUrl(m.thumbnailKey) : null,
      createdAt: m.createdAt.toISOString(),
      version: { id: m.version.id, name: m.version.name, taskName: m.version.task?.name ?? null },
      decided: decided.has(m.version.id),
      placement: placementOf(m),
    })),
  );
  return { media, browse: buildShareBrowse(rows), total, hasMore: total > rows.length };
}

/**
 * Quelles playlists CE lien nomme.
 *
 * - `PROJECT` : celles du projet qui contiennent au moins un média de la portée — le `some`
 *   est écrit avec `shareMediaWhere` lui-même, une playlist ne peut donc pas servir de
 *   passe-droit vers un brouillon ou la corbeille.
 * - `PLAYLIST` : celle du lien, épinglée par `id` ET `projectId`.
 * - `VERSION` / `MEDIA` : **aucune**. `null`, et non une liste calculée : nommer « les
 *   playlists qui contiennent cette version » révélerait l'existence de dailies que le
 *   destinataire n'a jamais reçus. Une portée qui ne montre qu'un plan ne nomme rien d'autre.
 * - `PLAYLIST` sans cible : `null` aussi — une portée dont la cible a disparu ne retombe pas
 *   sur « tout », même pour une simple liste de noms.
 */
export function sharePlaylistWhere(share: ShareScopeRef): Prisma.PlaylistWhereInput | null {
  const holdsVisibleMedia = { some: { version: { media: { some: shareMediaWhere(share) } } } };
  switch (share.scope) {
    case ShareScope.PROJECT:
      return { projectId: share.projectId, items: holdsVisibleMedia };
    case ShareScope.PLAYLIST:
      return share.playlistId == null
        ? null
        : { id: share.playlistId, projectId: share.projectId, items: holdsVisibleMedia };
    default:
      return null;
  }
}

/** Au-delà, une page d'accueil de partage cesse d'être un accueil. */
export const SHARE_PLAYLIST_LIMIT = 30;

/** Une carte de playlist de l'accueil — des identifiants, jamais une vignette de plus. */
export interface SharePlaylistCard {
  id: number;
  name: string;
  updatedAt: string;
  /** Items en portée : peut dépasser `mediaIds.length` quand la page est bornée. */
  itemCount: number;
  /** Médias de la playlist PRÉSENTS dans la page servie, dans l'ordre de la playlist. */
  mediaIds: number[];
  coverMediaIds: number[];
}

/**
 * Cartes de playlist de l'accueil. Les identifiants sont **intersectés** avec la page de
 * médias déjà renvoyée : un id au-delà du plafond désignerait une tuile absente du payload,
 * donc une vignette vide. `itemCount`, lui, reste le total en portée — la carte dit la
 * vérité sur ce que la playlist contient, la grille ne montre que ce qu'elle peut ouvrir.
 */
export async function listSharePlaylists(
  share: ShareScopeRef,
  visibleMediaIds: ReadonlySet<number>,
): Promise<SharePlaylistCard[]> {
  const where = sharePlaylistWhere(share);
  if (!where) return [];
  const inScope = { version: { media: { some: shareMediaWhere(share) } } };
  const playlists = await prisma.playlist.findMany({
    where,
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    take: SHARE_PLAYLIST_LIMIT,
    select: {
      id: true,
      name: true,
      updatedAt: true,
      // Compteur FILTRÉ par la portée : un `_count` nu annoncerait « 12 » pour trois items
      // ouvrables.
      _count: { select: { items: { where: inScope } } },
      items: {
        where: inScope,
        orderBy: { order: 'asc' },
        select: {
          version: {
            select: {
              media: {
                where: shareMediaWhere(share),
                orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
                select: { id: true }, // des identifiants : aucune signature de plus
              },
            },
          },
        },
      },
    },
  });
  return playlists.map((playlist) => {
    const mediaIds = playlist.items
      .flatMap((item) => item.version.media.map((m) => m.id))
      .filter((id) => visibleMediaIds.has(id));
    return {
      id: playlist.id,
      name: playlist.name,
      updatedAt: playlist.updatedAt.toISOString(),
      itemCount: playlist._count.items,
      mediaIds,
      coverMediaIds: mediaIds.slice(0, 4),
    };
  });
}

/**
 * Un média précis, s'il est dans la portée du lien. Le `AND` n'est pas cosmétique : la
 * portée MEDIA pose elle-même un filtre `id`, qu'un objet littéral écraserait.
 */
export async function findShareMedia(share: ShareScopeRef, id: number): Promise<MediaObject> {
  const media = await prisma.mediaObject.findFirst({ where: { AND: [{ id }, shareMediaWhere(share)] } });
  if (!media) throw notFound('Media not found, or not published');
  return media;
}

/**
 * Le fil qu'un invité lit — **liste blanche de colonnes**, pas un `include` sur la ligne
 * entière. Sans `select`, Prisma rend toutes les colonnes scalaires : `attachments` (des
 * clés MinIO), `assigneeId`, `resolvedById`, `state`, `timelineId` partaient sur une page
 * publique alors que rien ne les y affiche. `annotation` est le seul champ ajouté, et il
 * l'est délibérément : c'est ce qui permet au client de revoir le dessin qu'on lui montre,
 * et celui qu'il vient de poser.
 *
 * `OR: [{ timelineId: null }, { sharedToShot: true }]` : un retour écrit depuis un montage
 * n'appartient qu'à ce montage tant que personne ne l'a renvoyé sur la review du plan. Le
 * fil interne pose ce garde-fou depuis la Phase 46 ; la route publique l'avait oublié.
 */
export async function listShareComments(mediaObjectId: number) {
  return prisma.comment.findMany({
    where: {
      mediaObjectId,
      parentId: null,
      isVisibleToClient: true,
      OR: [{ timelineId: null }, { sharedToShot: true }],
    },
    orderBy: [{ timestamp: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      content: true,
      timestamp: true,
      duration: true,
      guestName: true,
      createdAt: true,
      isEdited: true,
      annotation: true,
      // `id` + `name` et rien d'autre : le fil les affiche, et l'identifiant sert de clé de
      // rendu. Ni e-mail, ni avatar, ni rôle ne descendent sur une page publique.
      author: { select: { id: true, name: true } },
    },
  });
}

/** Les deux réponses que ce lien peut poser, ou `null` s'il n'en a pas le droit. */
export async function shareDecisionStatuses(share: ShareRecord) {
  if (share.permission !== SharePermission.DECIDE) return null;
  return guestStatuses(share.projectId);
}

/** Ce qu'un invité envoie avec son retour. Les formes libres sont revalidées à l'écriture. */
export interface ShareCommentInput {
  guestName: string;
  content: string;
  timestamp?: number;
  cameraState?: unknown;
  annotation?: unknown;
}

/**
 * Retour d'un invité. Deux gardes avant d'écrire, dans cet ordre : la **permission** du lien
 * (un lien en lecture seule ne devient pas commentable parce qu'on lui poste un corps
 * valide) puis la **portée** — `findShareMedia` refuse un identifiant deviné, y compris
 * celui d'un média du même projet.
 *
 * `createGuest` déclenche ensuite la même chaîne qu'un retour interne (suiveurs, webhooks,
 * journal v1, note ShotGrid) : le retour d'un client n'est pas un citoyen de seconde zone.
 */
/**
 * Avis d'un invité sur la version que porte un média — **un avis, pas un verdict**.
 *
 * Trois gardes, dans cet ordre : la **permission** du lien (seul `DECIDE` ouvre ce droit ;
 * commenter et se prononcer ne sont pas le même mandat), la **portée** — `findShareMedia`
 * refuse un identifiant deviné — puis le **statut**, que `decideAsGuest` restreint aux deux
 * réponses offertes. Le statut courant de la version n'est jamais touché.
 */
export async function createShareDecision(
  share: ShareRecord,
  mediaObjectId: number,
  body: { guestName: string; statusId: number; comment?: string },
) {
  if (share.permission !== SharePermission.DECIDE) throw forbidden('This link cannot record a decision');
  const media = await findShareMedia(share, mediaObjectId);
  return decideAsGuest(
    { name: body.guestName, shareLinkId: share.id },
    share.projectId,
    media.versionId,
    body.statusId,
    body.comment,
  );
}

export async function createShareComment(
  share: ShareRecord,
  mediaObjectId: number,
  body: ShareCommentInput,
  ip?: string,
) {
  if (share.permission !== SharePermission.COMMENT) throw forbidden('This link is read-only');
  await findShareMedia(share, mediaObjectId);
  const comment = await createGuest(
    { name: body.guestName, shareLinkId: share.id, shareOwnerId: share.createdById },
    share.projectId,
    {
      mediaObjectId,
      content: body.content,
      timestamp: body.timestamp,
      cameraState: body.cameraState,
      annotation: body.annotation,
    },
  );
  // Un retour d'invité ne laissait pour trace que la charge utile d'un webhook : le journal
  // d'audit dit désormais quel lien a écrit, et sur quel média. Sans le texte du retour —
  // le journal est rendu à l'écran d'administration et recopié dans pino.
  logAudit({
    action: 'SHARE_COMMENT',
    entityType: 'Project',
    entityId: share.projectId,
    metadata: {
      shareLinkId: share.id,
      mediaObjectId,
      hasAnnotation: body.annotation != null,
      ip: ip ?? null,
    },
  });
  return comment;
}

/**
 * Consomme une vue (incrément atomique, borné par `maxViews` côté SQL pour éviter toute
 * course). Lève 410 si la limite est atteinte.
 */
export async function consumeView(share: ShareLink): Promise<void> {
  const where =
    share.maxViews != null ? { id: share.id, viewCount: { lt: share.maxViews } } : { id: share.id };
  const updated = await prisma.shareLink.updateMany({
    where,
    data: { viewCount: { increment: 1 }, lastViewedAt: new Date() },
  });
  if (updated.count === 0) throw new AppError('This link has reached its view limit', 410);
}

/** Habillage studio de la page client : nom + logo (Setting `studio_logo_key`, présigné). */
export async function studioBranding(): Promise<{ name: string; logoUrl: string | null }> {
  const [studio, logo] = await Promise.all([
    prisma.studio.findFirst({ select: { name: true } }),
    prisma.setting.findUnique({ where: { key: STUDIO_LOGO_KEY } }),
  ]);
  return {
    name: studio?.name ?? 'ReView',
    logoUrl: logo?.value
      ? await storage.getPresignedGetUrl(logo.value, 3600, imageTypeFromKey(logo.value))
      : null,
  };
}

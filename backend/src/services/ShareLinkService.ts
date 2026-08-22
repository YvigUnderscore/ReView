// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { ShareScope, type MediaKind, type SharePermission } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { logAudit } from './AuditService';
import { publishedMediaWhere } from './ClientShareService';
import { badRequest, notFound } from '../lib/errors';

/**
 * Côté studio du partage : créer, lister et révoquer les liens, et proposer de quoi
 * choisir leur portée.
 *
 * La portée est la raison d'être de ce service. Un lien ne connaissait que son projet ;
 * il fallait donc, pour montrer un plan à un client, lui ouvrir le film entier. La cible
 * est vérifiée ICI (elle appartient bien au projet) et jamais reprise du corps de la
 * requête telle quelle : une playlist d'un autre projet ferait fuiter ce projet-là.
 */

/** Champs renvoyés à l'admin — jamais le hash du mot de passe, un booléen suffit. */
const linkSelect = {
  id: true,
  token: true,
  projectId: true,
  permission: true,
  label: true,
  maxViews: true,
  viewCount: true,
  lastViewedAt: true,
  expiresAt: true,
  revoked: true,
  createdAt: true,
  scope: true,
  playlistId: true,
  versionId: true,
  playlist: { select: { name: true } },
  version: { select: { name: true } },
  media: { select: { mediaObjectId: true } },
  createdBy: { select: { id: true, name: true } },
} as const;

/** Au-delà, ce n'est plus une sélection : c'est un partage de projet qui s'ignore. */
export const SHARE_SELECTION_LIMIT = 200;

/** Vue admin d'un lien : la sélection est aplatie, le mot de passe réduit à un booléen. */
function toView<T extends { media: { mediaObjectId: number }[] }>(link: T, hasPassword: boolean) {
  const { media, ...rest } = link;
  return { ...rest, mediaIds: media.map((m) => m.mediaObjectId), hasPassword };
}

export async function list(projectId: number) {
  const links = await prisma.shareLink.findMany({
    where: { projectId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { ...linkSelect, passwordHash: true },
  });
  return links.map(({ passwordHash, ...l }) => toView(l, passwordHash != null));
}

export interface ShareScopeInput {
  scope?: ShareScope;
  playlistId?: number;
  versionId?: number;
  mediaIds?: number[];
}

export interface ResolvedShareScope {
  scope: ShareScope;
  playlistId: number | null;
  versionId: number | null;
  mediaIds: number[];
}

/** Version du projet, quel que soit son rattachement (tâche de plan, tâche d'asset, asset). */
const versionOfProject = (projectId: number) => ({
  deletedAt: null,
  OR: [{ task: { shot: { projectId } } }, { task: { asset: { projectId } } }, { asset: { projectId } }],
});

/**
 * Valide la portée demandée et la ramène à sa forme canonique. Toute cible est confrontée
 * au projet du lien : c'est le seul endroit où l'on peut encore empêcher un lien de
 * pointer hors de son projet.
 */
export async function resolveScope(projectId: number, input: ShareScopeInput): Promise<ResolvedShareScope> {
  const scope = input.scope ?? ShareScope.PROJECT;
  const empty = { playlistId: null, versionId: null, mediaIds: [] as number[] };

  if (scope === ShareScope.PLAYLIST) {
    if (input.playlistId == null)
      throw badRequest('A playlist is required for this scope', 'SCOPE_TARGET_MISSING');
    const playlist = await prisma.playlist.findFirst({
      where: { id: input.playlistId, projectId },
      select: { id: true },
    });
    if (!playlist) throw badRequest('This playlist is not in the project', 'SCOPE_TARGET_FOREIGN');
    return { ...empty, scope, playlistId: playlist.id };
  }

  if (scope === ShareScope.VERSION) {
    if (input.versionId == null)
      throw badRequest('A version is required for this scope', 'SCOPE_TARGET_MISSING');
    const version = await prisma.version.findFirst({
      where: { id: input.versionId, ...versionOfProject(projectId) },
      select: { id: true },
    });
    if (!version) throw badRequest('This version is not in the project', 'SCOPE_TARGET_FOREIGN');
    return { ...empty, scope, versionId: version.id };
  }

  if (scope === ShareScope.MEDIA) {
    const asked = [...new Set(input.mediaIds ?? [])];
    if (asked.length === 0)
      throw badRequest('Select at least one media for this scope', 'SCOPE_TARGET_MISSING');
    if (asked.length > SHARE_SELECTION_LIMIT)
      throw badRequest('Too many media for a single link', 'SCOPE_SELECTION_TOO_LARGE');
    // On ne garde que ce qui est réellement partageable : un média non publié dans la
    // sélection deviendrait visible le jour de sa publication, sans nouvelle décision.
    const rows = await prisma.mediaObject.findMany({
      where: { AND: [{ id: { in: asked } }, publishedMediaWhere(projectId)] },
      select: { id: true },
    });
    if (rows.length !== asked.length)
      throw badRequest('Some media are not published in this project', 'SCOPE_TARGET_FOREIGN');
    return { ...empty, scope, mediaIds: rows.map((r) => r.id) };
  }

  return { ...empty, scope: ShareScope.PROJECT };
}

export interface CreateShareInput extends ShareScopeInput {
  projectId: number;
  permission: SharePermission;
  label?: string;
  password?: string;
  maxViews?: number;
  expiresInDays?: number;
}

export async function create(userId: number, body: CreateShareInput) {
  const scope = await resolveScope(body.projectId, body);
  const token = randomBytes(24).toString('hex');
  const expiresAt = body.expiresInDays ? new Date(Date.now() + body.expiresInDays * 86_400_000) : null;
  const passwordHash = body.password ? await bcrypt.hash(body.password, 12) : null;
  const link = await prisma.shareLink.create({
    data: {
      token,
      projectId: body.projectId,
      permission: body.permission,
      label: body.label ?? null,
      passwordHash,
      maxViews: body.maxViews ?? null,
      expiresAt,
      createdById: userId,
      scope: scope.scope,
      playlistId: scope.playlistId,
      versionId: scope.versionId,
      media: { create: scope.mediaIds.map((mediaObjectId) => ({ mediaObjectId })) },
    },
    select: linkSelect,
  });
  logAudit({
    userId,
    action: 'SHARE_CREATE',
    entityType: 'Project',
    entityId: body.projectId,
    metadata: {
      permission: body.permission,
      label: body.label ?? null,
      hasPassword: passwordHash != null,
      maxViews: body.maxViews ?? null,
      expiresAt: expiresAt?.toISOString() ?? null,
      scope: scope.scope,
      playlistId: scope.playlistId,
      versionId: scope.versionId,
      mediaCount: scope.mediaIds.length,
    },
  });
  return toView(link, passwordHash != null);
}

/** Révoque un lien. Renvoie le projet concerné, pour l'assertion RBAC de la route. */
export async function projectOf(id: number): Promise<number> {
  const link = await prisma.shareLink.findUnique({ where: { id }, select: { projectId: true } });
  if (!link) throw notFound('Link not found');
  return link.projectId;
}

export async function revoke(userId: number, id: number, projectId: number): Promise<void> {
  await prisma.shareLink.update({ where: { id }, data: { revoked: true } });
  logAudit({
    userId,
    action: 'SHARE_REVOKE',
    entityType: 'Project',
    entityId: projectId,
    metadata: { shareLinkId: id },
  });
}

/** Une ligne du sélecteur de médias, à la création d'un lien. */
export interface ShareCandidate {
  id: number;
  originalName: string;
  kind: MediaKind;
  versionId: number;
  versionName: string;
  /** Où le média vit, à l'œil : « SQ010 · SH020 › comp ». */
  location: string;
  createdAt: string;
}

type CandidateRow = {
  name: string;
  task: { name: string; shot: { code: string } | null; asset: { name: string } | null } | null;
  asset: { name: string } | null;
};

/** Chemin lisible d'une version — pure, testée : c'est tout ce qui distingue deux tuiles. */
export function candidateLocation(version: CandidateRow): string {
  const parent = version.task?.shot?.code ?? version.task?.asset?.name ?? version.asset?.name ?? null;
  const step = version.task?.name ?? null;
  if (parent && step) return `${parent} › ${step}`;
  return parent ?? step ?? version.name;
}

/** Médias publiés du projet, bornés : la matière du sélecteur « sélection de médias ». */
export async function candidates(projectId: number): Promise<ShareCandidate[]> {
  const rows = await prisma.mediaObject.findMany({
    where: publishedMediaWhere(projectId),
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: SHARE_SELECTION_LIMIT,
    select: {
      id: true,
      originalName: true,
      kind: true,
      createdAt: true,
      versionId: true,
      version: {
        select: {
          name: true,
          task: {
            select: { name: true, shot: { select: { code: true } }, asset: { select: { name: true } } },
          },
          asset: { select: { name: true } },
        },
      },
    },
  });
  return rows.map((m) => ({
    id: m.id,
    originalName: m.originalName,
    kind: m.kind,
    versionId: m.versionId,
    versionName: m.version.name,
    location: candidateLocation(m.version),
    createdAt: m.createdAt.toISOString(),
  }));
}

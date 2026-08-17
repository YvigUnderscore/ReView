// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { prisma } from '../lib/prisma';
import { notFound } from '../lib/errors';
import { getProjectStorageUsage } from '../lib/projectQuota';
import {
  resolveProjectSettings,
  resolveEntitySettings,
  type ProjectSettings,
  type PipelineSettings,
} from '../lib/projectSettings';
import { toPublicUser } from '../lib/userView';
import { versionWhere, commentWhere } from './AdminContentService';

/**
 * Vue d'administration des projets : liste enrichie (compteurs + stockage/quota) et
 * fiche détaillée (membres, réglages résolus, hiérarchie séquences→shots avec héritage
 * pipeline visible à chaque niveau). La mise en forme de la hiérarchie est pure (testée).
 */

// ── Hiérarchie (pure) ────────────────────────────────────────────────────────

export interface HierarchyShotRow {
  id: number;
  code: string;
  name: string;
  startFrame: number | null;
  endFrame: number | null;
  settings: unknown;
}
export interface HierarchySequenceRow {
  id: number;
  code: string;
  name: string;
  settings: unknown;
  shots: HierarchyShotRow[];
}

/** Un JSON de réglages contient-il un override pipeline (résolution ou framerate) ? */
export function hasPipelineOverride(raw: unknown): boolean {
  const o = (raw ?? {}) as { resolution?: unknown; framerate?: unknown };
  return (o.resolution != null && typeof o.resolution === 'object') || Number.isFinite(o.framerate);
}

export interface HierarchyShotView {
  id: number;
  code: string;
  name: string;
  startFrame: number | null;
  endFrame: number | null;
  override: boolean;
  effective: PipelineSettings;
}

/**
 * Met en forme la hiérarchie séquences→shots avec, à chaque niveau, les réglages
 * pipeline effectifs (héritage projet→séquence→shot) et un drapeau « override ».
 */
export function buildHierarchy(
  project: ProjectSettings,
  sequences: HierarchySequenceRow[],
  orphanShots: HierarchyShotRow[],
): {
  sequences: (Omit<HierarchySequenceRow, 'settings' | 'shots'> & {
    override: boolean;
    effective: PipelineSettings;
    shots: HierarchyShotView[];
  })[];
  noSequence: HierarchyShotView[];
} {
  const shotView = (shot: HierarchyShotRow, sequenceOverride?: unknown): HierarchyShotView => ({
    id: shot.id,
    code: shot.code,
    name: shot.name,
    startFrame: shot.startFrame,
    endFrame: shot.endFrame,
    override: hasPipelineOverride(shot.settings),
    effective: resolveEntitySettings(project, sequenceOverride, shot.settings),
  });
  return {
    sequences: sequences.map((s) => ({
      id: s.id,
      code: s.code,
      name: s.name,
      override: hasPipelineOverride(s.settings),
      effective: resolveEntitySettings(project, s.settings),
      shots: s.shots.map((shot) => shotView(shot, s.settings)),
    })),
    noSequence: orphanShots.map((shot) => shotView(shot)),
  };
}

// ── Requêtes ─────────────────────────────────────────────────────────────────

/** Liste enrichie de tous les projets (admin) : compteurs, stockage consommé, quota. */
export async function listProjects() {
  const projects = await prisma.project.findMany({
    where: { deletedAt: null },
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      slug: true,
      status: true,
      createdAt: true,
      storageQuota: true,
      _count: {
        select: {
          memberships: true,
          sequences: { where: { deletedAt: null } },
          shots: { where: { deletedAt: null } },
          assets: { where: { deletedAt: null } },
        },
      },
    },
  });
  return Promise.all(
    projects.map(async (p) => {
      const [usage, versions, media] = await Promise.all([
        getProjectStorageUsage(p.id),
        prisma.version.count({ where: versionWhere({ projectId: p.id }) }),
        prisma.mediaObject.count({
          where: { deletedAt: null, version: versionWhere({ projectId: p.id }) },
        }),
      ]);
      return {
        id: p.id,
        name: p.name,
        slug: p.slug,
        status: p.status,
        createdAt: p.createdAt,
        usage: Number(usage),
        quota: p.storageQuota != null ? Number(p.storageQuota) : null,
        counts: { ...p._count, versions, media },
      };
    }),
  );
}

/** Fiche détaillée d'un projet (admin) : membres, réglages résolus, hiérarchie, stats. */
export async function projectDetail(id: number) {
  const project = await prisma.project.findFirst({
    where: { id },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      status: true,
      startFrame: true,
      createdAt: true,
      updatedAt: true,
      deletedAt: true,
      storageQuota: true,
      settings: true,
      memberships: {
        orderBy: { joinedAt: 'asc' },
        select: {
          id: true,
          role: true,
          joinedAt: true,
          user: {
            select: {
              id: true,
              email: true,
              name: true,
              firstName: true,
              lastName: true,
              username: true,
              avatarKey: true,
              role: true,
            },
          },
        },
      },
      sequences: {
        where: { deletedAt: null },
        orderBy: [{ order: 'asc' }, { code: 'asc' }],
        select: {
          id: true,
          code: true,
          name: true,
          settings: true,
          shots: {
            where: { deletedAt: null },
            orderBy: [{ order: 'asc' }, { code: 'asc' }],
            select: {
              id: true,
              code: true,
              name: true,
              startFrame: true,
              endFrame: true,
              settings: true,
            },
          },
        },
      },
      shots: {
        where: { deletedAt: null, sequenceId: null },
        orderBy: [{ order: 'asc' }, { code: 'asc' }],
        select: { id: true, code: true, name: true, startFrame: true, endFrame: true, settings: true },
      },
    },
  });
  if (!project) throw notFound('Projet introuvable');

  const settings = await resolveProjectSettings(project.settings);
  const [usage, versions, mediaAgg, comments, assets, members] = await Promise.all([
    getProjectStorageUsage(id),
    prisma.version.count({ where: versionWhere({ projectId: id }) }),
    prisma.mediaObject.aggregate({
      where: { deletedAt: null, version: versionWhere({ projectId: id }) },
      _count: { _all: true },
      _sum: { size: true },
    }),
    prisma.comment.count({ where: commentWhere({ projectId: id }) }),
    prisma.asset.count({ where: { projectId: id, deletedAt: null } }),
    Promise.all(
      project.memberships.map(async (m) => ({
        id: m.id,
        role: m.role,
        joinedAt: m.joinedAt,
        user: await toPublicUser(m.user),
      })),
    ),
  ]);

  return {
    project: {
      id: project.id,
      name: project.name,
      slug: project.slug,
      description: project.description,
      status: project.status,
      startFrame: project.startFrame,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      deletedAt: project.deletedAt,
      usage: Number(usage),
      quota: project.storageQuota != null ? Number(project.storageQuota) : null,
    },
    members,
    settings,
    hierarchy: buildHierarchy(settings, project.sequences, project.shots),
    stats: {
      versions,
      media: mediaAgg._count._all,
      mediaBytes: Number(mediaAgg._sum.size ?? 0n),
      comments,
      assets,
    },
  };
}

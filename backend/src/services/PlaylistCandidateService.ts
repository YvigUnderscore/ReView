// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { type Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { storage } from './StorageService';

/**
 * Catalogue des versions qu'on peut mettre dans une playlist (C5).
 *
 * Il n'existait aucune recherche d'entités réutilisable : celle de la palette plafonne à
 * cinq résultats par type et ignore les versions. Monter une playlist de dailies obligeait
 * donc à ouvrir chaque plan un par un et à y cliquer « ajouter ».
 *
 * Une version pend d'une tâche (elle-même sous un plan ou un asset) ou directement d'un
 * asset : les trois chemins sont couverts, sans quoi tout un pan du projet reste
 * introuvable selon la façon dont le studio range son travail.
 */

export interface CandidateQuery {
  q?: string;
  sequenceId?: number | 'none';
  /** Clé de département, telle que la tâche la dénormalise. */
  department?: string;
  /** Ne garder que la dernière version de chaque tâche — le cas ordinaire des dailies. */
  latestOnly?: boolean;
  limit?: number;
}

export interface Candidate {
  versionId: number;
  name: string;
  /** Localisation lisible : « SQ010 · SH020 › comp ». */
  location: string;
  sequenceId: number | null;
  department: string | null;
  createdAt: string;
  reviewStatus: { id: number; name: string; color: string } | null;
  media: { id: number; kind: string; originalName: string; thumbnailUrl: string | null } | null;
}

function ownedByProject(projectId: number): Prisma.VersionWhereInput {
  return {
    OR: [{ task: { shot: { projectId } } }, { task: { asset: { projectId } } }, { asset: { projectId } }],
  };
}

/** Versions du projet, filtrées, avec de quoi les reconnaître à l'œil. */
export async function list(
  projectId: number,
  viewerId: number,
  query: CandidateQuery = {},
): Promise<Candidate[]> {
  const limit = query.limit ?? 100;
  const filters: Prisma.VersionWhereInput[] = [ownedByProject(projectId)];

  if (query.q) {
    const contains = { contains: query.q, mode: 'insensitive' as const };
    filters.push({
      OR: [
        { name: contains },
        { task: { name: contains } },
        { task: { shot: { code: contains } } },
        { task: { asset: { name: contains } } },
        { asset: { name: contains } },
      ],
    });
  }
  if (query.sequenceId === 'none') filters.push({ task: { shot: { sequenceId: null } } });
  else if (typeof query.sequenceId === 'number')
    filters.push({ task: { shot: { sequenceId: query.sequenceId } } });
  if (query.department) filters.push({ task: { department: query.department } });

  const versions = await prisma.version.findMany({
    where: { deletedAt: null, AND: filters },
    orderBy: { createdAt: 'desc' },
    // Le tri « dernière d'abord » ne survit pas au filtrage par tâche : on prend large,
    // puis on élit. La coupe finale se fait après.
    take: query.latestOnly ? limit * 4 : limit,
    select: {
      id: true,
      name: true,
      createdAt: true,
      taskId: true,
      reviewStatus: { select: { id: true, name: true, color: true } },
      task: {
        select: {
          name: true,
          department: true,
          shot: { select: { code: true, sequenceId: true, sequence: { select: { code: true } } } },
          asset: { select: { name: true } },
        },
      },
      asset: { select: { name: true } },
      media: {
        // Même règle de visibilité que partout : publié, ou déposé par le demandeur.
        where: { deletedAt: null, status: 'READY', OR: [{ published: true }, { uploaderId: viewerId }] },
        orderBy: { createdAt: 'asc' },
        take: 1,
        select: { id: true, kind: true, originalName: true, thumbnailKey: true },
      },
    },
  });

  const kept = query.latestOnly ? keepLatestPerTask(versions) : versions;

  return Promise.all(
    kept.slice(0, limit).map(async (v) => {
      const t = v.task;
      const location = t?.shot
        ? `${t.shot.sequence ? `${t.shot.sequence.code} · ` : ''}${t.shot.code} › ${t.name}`
        : t?.asset
          ? `${t.asset.name} › ${t.name}`
          : (v.asset?.name ?? '');
      const first = v.media[0] ?? null;
      return {
        versionId: v.id,
        name: v.name,
        location,
        sequenceId: t?.shot?.sequenceId ?? null,
        department: t?.department ?? null,
        createdAt: v.createdAt.toISOString(),
        reviewStatus: v.reviewStatus,
        media: first
          ? {
              id: first.id,
              kind: first.kind,
              originalName: first.originalName,
              thumbnailUrl: first.thumbnailKey ? await storage.getPresignedGetUrl(first.thumbnailKey) : null,
            }
          : null,
      };
    }),
  );
}

/** La liste est déjà triée du plus récent au plus ancien : la première vue par tâche gagne. */
function keepLatestPerTask<T extends { id: number; taskId: number | null }>(versions: T[]): T[] {
  const seen = new Set<number>();
  return versions.filter((v) => {
    // Une version rattachée directement à un asset n'a pas de tâche : elle se garde
    // toujours, sans quoi tout un pan du catalogue disparaîtrait de la recherche.
    if (v.taskId === null) return true;
    if (seen.has(v.taskId)) return false;
    seen.add(v.taskId);
    return true;
  });
}

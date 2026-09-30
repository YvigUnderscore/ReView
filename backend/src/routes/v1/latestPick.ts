// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Request } from 'express';
import { z } from 'zod';
import { MediaStatus, type Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { notFound } from '../../lib/errors';
import { pickMostAdvanced } from '../../lib/pipelineOrder';
import { resolveProjectSettingsById } from '../../lib/projectSettings';
import { versionSelect, mediaSelect, toVersion, toMedia } from '../../lib/v1Resources';
import { DEFAULT_URL_TTL, toMediaWithUrl } from './mediaAccess';

/**
 * « Quelle est la dernière version ? » — la question que pose tout script de DCC avant
 * d'ouvrir un plan, et à laquelle l'API v1 ne savait pas répondre.
 *
 * La règle est celle du reste du produit (`lib/pipelineOrder`) : l'étape du pipe la plus
 * avancée qui a quelque chose à montrer, puis la plus récente à cette étape. Sur une
 * tâche, où l'étape est constante, cela se réduit à « la plus récente » — mais sur un plan
 * il ne faut surtout pas rendre l'anim publiée après le compositing.
 *
 * Une version élue porte forcément un média visible : « la dernière version » sans fichier
 * n'a aucun usage pour l'appelant, qui veut télécharger quelque chose.
 */

/** Parent de la recherche : une tâche, un plan, un asset — jamais deux. */
export type LatestTarget = { taskId: number } | { shotId: number } | { assetId: number };

export const latestQuery = z.object({
  /** `false` inclut les brouillons — ce que veut l'artiste qui relit son propre travail. */
  published: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .default('true'),
  /** `true` joint une URL présignée à chaque média : un appel au lieu de deux par fichier. */
  urls: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .default('false'),
  expiresIn: z.coerce.number().int().min(60).max(86_400).default(DEFAULT_URL_TTL),
  /** Restreint l'élection à une étape du pipe (`comp`, `anim`…), par clé de département. */
  department: z.string().trim().max(80).optional(),
});

export type LatestOptions = z.infer<typeof latestQuery> & { projectId: number; viewerId: number };

/**
 * Ce qui rend un média visible pour l'appelant.
 *
 * `published=false` ouvre les brouillons — mais ceux de l'appelant seulement : dans tout
 * le produit, un média non publié n'appartient qu'à celui qui l'a déposé (cf.
 * `MediaService.getUrl`). Sans ce filtre, un membre du projet lirait le travail en cours
 * de ses collègues, URL de téléchargement comprise.
 */
const mediaFilter = (opts: { published: boolean; viewerId: number }): Prisma.MediaObjectWhereInput =>
  opts.published
    ? { deletedAt: null, published: true, status: MediaStatus.READY }
    : { deletedAt: null, OR: [{ published: true }, { uploaderId: opts.viewerId }] };

const parentFilter = (target: LatestTarget): Prisma.VersionWhereInput => {
  if ('taskId' in target) return { taskId: target.taskId };
  if ('shotId' in target) return { task: { shotId: target.shotId } };
  // Un asset porte des versions par ses tâches, et parfois en direct (héritage).
  return { OR: [{ task: { assetId: target.assetId } }, { assetId: target.assetId }] };
};

/**
 * Élit la version. On ne charge que le strict nécessaire au classement — l'identifiant, la
 * date et l'étape — puis on relit la seule gagnante : une tâche de production peut porter
 * cinquante versions, il n'y a aucune raison de les rapatrier entières.
 */
async function electVersionId(target: LatestTarget, opts: LatestOptions): Promise<number | null> {
  const rows = await prisma.version.findMany({
    where: {
      ...parentFilter(target),
      deletedAt: null,
      ...(opts.published ? { published: true } : {}),
      media: { some: mediaFilter(opts) },
    },
    select: { id: true, createdAt: true, task: { select: { department: true } } },
  });
  const scoped = opts.department
    ? rows.filter((r) => (r.task?.department ?? '').toLowerCase() === opts.department?.toLowerCase())
    : rows;
  if (scoped.length === 0) return null;

  const { departments } = await resolveProjectSettingsById(opts.projectId);
  const winner = pickMostAdvanced(
    scoped.map((r) => ({ id: r.id, at: r.createdAt, department: r.task?.department ?? null })),
    departments,
  );
  return winner?.id ?? null;
}

/**
 * La version élue, telle que le contrat v1 la rend : ressource `version`, ses médias
 * visibles, et — sur demande — l'URL de chacun. Rien de plus qu'un `GET /versions/:id`
 * enrichi, pour qu'un client n'ait pas à apprendre une deuxième forme.
 */
export async function respondLatest(target: LatestTarget, opts: LatestOptions) {
  const versionId = await electVersionId(target, opts);
  if (versionId === null) {
    throw notFound('No version with a readable media here', 'NO_LATEST_VERSION');
  }
  const row = await prisma.version.findUnique({
    where: { id: versionId },
    select: {
      ...versionSelect,
      media: {
        where: mediaFilter(opts),
        orderBy: { createdAt: 'asc' },
        select: { ...mediaSelect, storageKey: true, metadata: true },
      },
    },
  });
  if (!row) throw notFound('Version not found');

  const base = toVersion(row);
  const media = opts.urls
    ? await Promise.all(row.media.map((m) => toMediaWithUrl(m, opts.expiresIn)))
    : row.media.map(toMedia);
  return { version: { ...base, media } };
}

/** Relit la query typée (Express 5) et y joint le contexte manquant : projet et lecteur. */
export const latestOptions = (req: Request, projectId: number): LatestOptions => ({
  ...latestQuery.parse(req.query),
  projectId,
  viewerId: req.user!.id,
});

// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { prisma } from '../lib/prisma';
import { notFound } from '../lib/errors';
import { parsePipelinePath, type PipelinePath, type PipelineEntityKind } from '../lib/pipelinePath';
import {
  projectSelect,
  sequenceSelect,
  shotSelect,
  assetSelect,
  taskSelect,
  versionSelect,
} from '../lib/v1Resources';

/**
 * Résolution des entités du pipeline à partir de noms (API v1).
 *
 * Toute lecture est insensible à la casse : un DCC écrit `sh0100` là où la production a
 * saisi `SH0100`, et refuser sur ce détail rendrait l'API inutilisable en pratique. Les
 * codes restent uniques par parent côté base, la casse ne crée donc pas d'ambiguïté.
 *
 * Rien ici ne vérifie les droits : le projet résolu est renvoyé à l'appelant, à charge
 * pour la route d'appeler `assertProjectAccess` avant d'exposer quoi que ce soit.
 */

/** Une référence est soit un identifiant numérique, soit un code/nom. */
const asId = (ref: string): number | null => (/^\d+$/.test(ref) ? Number(ref) : null);

const insensitive = (value: string) => ({ equals: value, mode: 'insensitive' as const });

export async function resolveProject(ref: string) {
  const id = asId(ref);
  const project = await prisma.project.findFirst({
    where: {
      deletedAt: null,
      ...(id !== null ? { id } : { OR: [{ slug: insensitive(ref) }, { name: insensitive(ref) }] }),
    },
    select: projectSelect,
  });
  if (!project) throw notFound(`Projet « ${ref} » introuvable`, 'PROJECT_NOT_FOUND');
  return project;
}

export async function resolveSequence(projectId: number, ref: string) {
  const id = asId(ref);
  const sequence = await prisma.sequence.findFirst({
    where: {
      projectId,
      deletedAt: null,
      ...(id !== null ? { id } : { OR: [{ code: insensitive(ref) }, { name: insensitive(ref) }] }),
    },
    select: sequenceSelect,
  });
  if (!sequence) throw notFound(`Séquence « ${ref} » introuvable`, 'SEQUENCE_NOT_FOUND');
  return sequence;
}

/**
 * Shot d'un projet. `sequenceId` à `null` cible explicitement les shots sans séquence ;
 * `undefined` cherche dans tout le projet (cas d'un client qui ne connaît que le code).
 */
export async function resolveShot(projectId: number, ref: string, sequenceId?: number | null) {
  const id = asId(ref);
  const shot = await prisma.shot.findFirst({
    where: {
      projectId,
      deletedAt: null,
      ...(sequenceId !== undefined ? { sequenceId } : {}),
      ...(id !== null ? { id } : { OR: [{ code: insensitive(ref) }, { name: insensitive(ref) }] }),
    },
    select: shotSelect,
  });
  if (!shot) throw notFound(`Shot « ${ref} » introuvable`, 'SHOT_NOT_FOUND');
  return shot;
}

export async function resolveAsset(projectId: number, ref: string) {
  const id = asId(ref);
  const asset = await prisma.asset.findFirst({
    where: {
      projectId,
      deletedAt: null,
      ...(id !== null ? { id } : { name: insensitive(ref) }),
    },
    select: assetSelect,
  });
  if (!asset) throw notFound(`Asset « ${ref} » introuvable`, 'ASSET_NOT_FOUND');
  return asset;
}

/**
 * Tâche d'un shot XOR d'un asset, par nom (ex. `anim`, `lighting`).
 *
 * `department` restreint la recherche : un pipeline nomme volontiers `main` la tâche de
 * chaque département, et sans cette précision `modeling:main` et `lookdev:main` seraient
 * la même tâche. Sans département, la recherche reste sur le seul nom — les chemins
 * historiques continuent de résoudre.
 */
export async function resolveTask(
  parent: { shotId?: number; assetId?: number },
  ref: string,
  department?: string,
) {
  const id = asId(ref);
  const task = await prisma.task.findFirst({
    where: {
      ...(parent.shotId !== undefined ? { shotId: parent.shotId } : { assetId: parent.assetId }),
      ...(id !== null ? { id } : { name: insensitive(ref) }),
      ...(id === null && department ? { department: insensitive(department) } : {}),
    },
    select: taskSelect,
  });
  if (!task) throw notFound(`Tâche « ${ref} » introuvable`, 'TASK_NOT_FOUND');
  return task;
}

/** Version d'une tâche XOR d'un asset, par nom (ex. `v003`). */
export async function resolveVersion(parent: { taskId?: number; assetId?: number }, ref: string) {
  const id = asId(ref);
  const version = await prisma.version.findFirst({
    where: {
      deletedAt: null,
      ...(parent.taskId !== undefined ? { taskId: parent.taskId } : { assetId: parent.assetId }),
      ...(id !== null ? { id } : { name: insensitive(ref) }),
    },
    select: versionSelect,
  });
  if (!version) throw notFound(`Version « ${ref} » introuvable`, 'VERSION_NOT_FOUND');
  return version;
}

export interface ResolvedPath {
  kind: PipelineEntityKind;
  projectId: number;
  project: Awaited<ReturnType<typeof resolveProject>>;
  sequence?: Awaited<ReturnType<typeof resolveSequence>>;
  shot?: Awaited<ReturnType<typeof resolveShot>>;
  asset?: Awaited<ReturnType<typeof resolveAsset>>;
  task?: Awaited<ReturnType<typeof resolveTask>>;
  version?: Awaited<ReturnType<typeof resolveVersion>>;
}

/** Résout la branche asset d'un chemin analysé. */
async function resolveAssetBranch(parsed: PipelinePath, out: ResolvedPath): Promise<void> {
  out.asset = await resolveAsset(out.projectId, parsed.asset!);
  if (parsed.task) out.task = await resolveTask({ assetId: out.asset.id }, parsed.task, parsed.department);
  if (parsed.version) {
    out.version = out.task
      ? await resolveVersion({ taskId: out.task.id }, parsed.version)
      : await resolveVersion({ assetId: out.asset.id }, parsed.version);
  }
}

/** Résout la branche séquence/shot d'un chemin analysé. */
async function resolveShotBranch(parsed: PipelinePath, out: ResolvedPath): Promise<void> {
  if (parsed.sequence) out.sequence = await resolveSequence(out.projectId, parsed.sequence);
  if (parsed.shot) {
    // Sans séquence dans le chemin (branche `shots/`), on cible les shots orphelins.
    out.shot = await resolveShot(out.projectId, parsed.shot, out.sequence ? out.sequence.id : null);
  }
  if (parsed.task && out.shot)
    out.task = await resolveTask({ shotId: out.shot.id }, parsed.task, parsed.department);
  if (parsed.version && out.task) out.version = await resolveVersion({ taskId: out.task.id }, parsed.version);
}

/**
 * Résout un chemin complet en entités. Chaque maillon manquant lève un 404 nommant le
 * segment fautif — un script de pipeline doit pouvoir dire *quoi* est introuvable.
 */
export async function resolvePath(raw: string): Promise<ResolvedPath> {
  const parsed = parsePipelinePath(raw);
  const project = await resolveProject(parsed.project);
  const out: ResolvedPath = { kind: parsed.kind, projectId: project.id, project };

  if (parsed.asset) await resolveAssetBranch(parsed, out);
  else await resolveShotBranch(parsed, out);

  return out;
}

/** Entité désignée par la feuille du chemin — ce que l'appelant a réellement demandé. */
export function leafOf(resolved: ResolvedPath) {
  switch (resolved.kind) {
    case 'version':
      return resolved.version;
    case 'task':
      return resolved.task;
    case 'asset':
      return resolved.asset;
    case 'shot':
      return resolved.shot;
    case 'sequence':
      return resolved.sequence;
    default:
      return resolved.project;
  }
}

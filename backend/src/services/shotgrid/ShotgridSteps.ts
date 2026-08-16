// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { badRequest, forbidden } from '../../lib/errors';
import { openConnection } from './ShotgridConfigService';
import { belongsToProject } from './shotgridProjectGuard';
import { writeAllowedOn } from './shotgridTemplateGuard';
import { asNumber, asString, sgStepToTaskType } from './shotgridMapper';
import { upsertLink } from './shotgridLinks';
import { can } from './shotgridSettings';

/**
 * Étapes de pipeline (« Pipeline Steps ») d'un site ShotGrid.
 *
 * Un asset qui n'a encore aucune tâche n'en est pas moins prêt à en recevoir : le site
 * connaît les étapes qu'il traverse — art, modeling, rigging, groom, lookdev — bien avant
 * qu'une tâche existe pour chacune. Les proposer permet de déposer un rendu sous la bonne
 * étape sans quitter ReView, là où il fallait auparavant aller créer la tâche à la main
 * dans ShotGrid, puis revenir et resynchroniser.
 *
 * Les étapes sont globales au site, pas propres à un projet : `Step` ne porte aucun champ
 * qui le relie à un projet, et `task_templates` est vide chez ce studio. On les rend donc
 * toutes, en signalant celles que le projet emploie déjà — ce sont presque toujours
 * celles qu'on cherche.
 */

export interface PipelineStep {
  sgId: number;
  code: string;
  shortName: string;
  entityType: 'Asset' | 'Shot';
  color: string | null;
  order: number;
  /** Une tâche du projet porte-t-elle déjà cette étape ? */
  used: boolean;
}

/** `25,118,27` (RGB décimal ShotGrid) → `#19761B`. */
function hexColor(value: unknown): string | null {
  const raw = asString(value);
  if (!raw) return null;
  const parts = raw.split(',').map((n) => Number.parseInt(n.trim(), 10));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
  return `#${parts.map((n) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0')).join('')}`;
}

export async function listSteps(projectId: number, entityType: 'Asset' | 'Shot'): Promise<PipelineStep[]> {
  const ctx = await openConnection(projectId);
  if (!can(ctx.settings, 'tasks', 'read')) return [];

  const records = await ctx.client.search('Step', {
    fields: ['code', 'short_name', 'entity_type', 'color', 'list_order'],
    filters: [['entity_type', 'is', entityType]],
    sort: 'list_order',
  });

  // Étapes déjà employées dans le projet : `Task.department` porte le nom du step.
  const local = await prisma.task.findMany({
    where: {
      OR: [{ shot: { projectId } }, { asset: { projectId } }],
      department: { not: null },
    },
    select: { department: true },
    distinct: ['department'],
  });
  const used = new Set(local.map((t) => (t.department ?? '').toLowerCase()));

  const steps = records
    .map((r, index) => ({
      sgId: r.id,
      code: asString(r.code) ?? `step-${r.id}`,
      shortName: asString(r.short_name) ?? asString(r.code) ?? '',
      entityType,
      color: hexColor(r.color),
      order: asNumber(r.list_order) ?? index,
      used: used.has((asString(r.code) ?? '').toLowerCase()),
    }))
    .sort((a, b) => Number(b.used) - Number(a.used) || a.order - b.order || a.code.localeCompare(b.code));

  // Un site accumule les étapes au fil des années : ArtFX en a deux nommées « art » et
  // deux « modeling » pour les assets. Deux lignes identiques dans une liste ne sont pas
  // un choix, c'est une devinette — on garde la première, qui est celle que le projet
  // emploie déjà si l'une des deux l'est. La casse ne départage pas : « Modeling » et
  // « modeling » se lisent pareil à l'écran.
  const seen = new Set<string>();
  return steps.filter((s) => {
    const key = s.code.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Crée la tâche manquante, d'abord sur ShotGrid puis ici.
 *
 * L'ordre n'est pas indifférent : le site fait foi, et une tâche créée localement d'abord
 * serait orpheline — `pullTasks` ne la reprendrait jamais faute de lien, et la corbeille
 * distante ne l'atteindrait pas davantage. On écrit donc là-bas, puis on rapatrie la
 * tâche avec son identifiant, comme n'importe quelle tâche importée.
 */
export async function createTaskFromStep(
  projectId: number,
  params: { stepSgId: number; parentType: 'asset' | 'shot'; parentId: number; name?: string },
  actorEmail: string | null,
): Promise<{ taskId: number; sgId: number; name: string }> {
  const ctx = await openConnection(projectId);
  if (!can(ctx.settings, 'tasks', 'write'))
    throw forbidden('L’écriture des tasks est désactivée pour ce projet');

  const parentLink = await prisma.shotgridLink.findFirst({
    where: { connectionId: ctx.connection.id, localType: params.parentType, localId: params.parentId },
    select: { sgId: true, sgType: true },
  });
  if (!parentLink) throw badRequest('Cette entité n’existe pas dans ShotGrid');

  const step = await ctx.client.findById('Step', params.stepSgId, ['code', 'short_name', 'entity_type']);
  if (!step) throw badRequest('Étape de pipeline inconnue');

  const name = params.name?.trim() || asString(step.code) || `step-${params.stepSgId}`;

  const created = await ctx.client.create('Task', {
    project: { type: 'Project', id: ctx.connection.sgProjectId },
    content: name,
    step: { type: 'Step', id: params.stepSgId },
    entity: { type: parentLink.sgType, id: parentLink.sgId },
  });

  // Ceinture et bretelles : on relit ce que le site a écrit et on vérifie qu'il s'agit
  // bien du projet visé, et pas d'un projet modèle. Une tâche mal placée ne se rattrape
  // pas — elle apparaît dans la production de quelqu'un d'autre.
  const check = await ctx.client.findById('Task', created.id, ['content', 'step', 'entity', 'project']);
  const scope = {
    sgProjectId: ctx.connection.sgProjectId,
    sgProjectName: ctx.connection.sgProjectName,
  };
  if (check && !belongsToProject(check, scope).ok) {
    logger.error({ projectId, sgId: created.id }, 'Task créée hors du projet lié — à retirer du site');
    throw badRequest('ShotGrid a rangé la task hors du projet visé');
  }
  if (check && !writeAllowedOn(check)) throw forbidden('Projet modèle ShotGrid : écriture refusée');

  const department = asString(step.code) ?? null;
  const task = await prisma.task.create({
    data: {
      name,
      type: sgStepToTaskType(department),
      department,
      ...(params.parentType === 'asset' ? { assetId: params.parentId } : { shotId: params.parentId }),
    },
  });

  await upsertLink({
    connectionId: ctx.connection.id,
    localType: 'task',
    localId: task.id,
    sgType: 'Task',
    sgId: created.id,
    data: { stepName: department, sgAssignees: [], sgStatusCode: null, durationMinutes: null },
  });

  logger.info({ projectId, taskId: task.id, sgId: created.id, actorEmail }, 'Task créée depuis une étape');
  return { taskId: task.id, sgId: created.id, name };
}

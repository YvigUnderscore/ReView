// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { badRequest, forbidden } from '../../lib/errors';
import { openConnection } from './ShotgridConfigService';
import { belongsToProject, projectFilter } from './shotgridProjectGuard';
import { writeAllowedOn } from './shotgridTemplateGuard';
import { asEntityRef, asNumber, asString, sgStepToTaskType } from './shotgridMapper';
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
 * `Step` est global au site — il ne porte aucun champ qui le relie à un projet, et
 * `task_templates` est vide chez ce studio. Mais une étape « du projet » se lit ailleurs :
 * dans les tasks qui y existent déjà. Ce sont elles qui font foi, et pour une raison
 * concrète : un site accumule des homonymes, et l'étape « modeling » employée par ce
 * projet porte l'identifiant 14 quand le catalogue en propose une autre sous le 1584.
 * Choisir la mauvaise range la task ailleurs que là où l'équipe la cherche.
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

export async function listSteps(
  projectId: number,
  entityType: 'Asset' | 'Shot',
  options: { all?: boolean } = {},
): Promise<PipelineStep[]> {
  const ctx = await openConnection(projectId);
  if (!can(ctx.settings, 'tasks', 'read')) return [];

  // Ce que le projet emploie : les étapes portées par ses tasks, avec LEURS identifiants.
  const projectTasks = await ctx.client.search('Task', {
    fields: ['step', 'entity'],
    filters: [projectFilter(ctx.connection.sgProjectId)],
    sort: 'id',
  });
  const inProject = new Map<number, string>();
  for (const task of projectTasks) {
    const ref = asEntityRef(task.step);
    const parent = asEntityRef(task.entity);
    // Une étape d'asset ne se propose pas sur un plan, et réciproquement.
    if (ref && parent?.type === entityType) inProject.set(ref.id, ref.name ?? `step-${ref.id}`);
  }

  const wanted = options.all || inProject.size === 0 ? null : new Set(inProject.keys());

  const records = await ctx.client.search('Step', {
    fields: ['code', 'short_name', 'entity_type', 'color', 'list_order'],
    filters: [['entity_type', 'is', entityType]],
    sort: 'list_order',
  });

  const steps = records
    .filter((r) => !wanted || wanted.has(r.id))
    .map((r, index) => ({
      sgId: r.id,
      code: asString(r.code) ?? `step-${r.id}`,
      shortName: asString(r.short_name) ?? asString(r.code) ?? '',
      entityType,
      color: hexColor(r.color),
      order: asNumber(r.list_order) ?? index,
      used: inProject.has(r.id),
    }))
    .sort((a, b) => Number(b.used) - Number(a.used) || a.order - b.order || a.code.localeCompare(b.code));

  return dedupeSteps(steps);
}

/**
 * Une étape par nom, une étape par code court.
 *
 * ShotGrid restreint les étapes proposées à celles dont la visibilité est activée dans le
 * projet, mais ne l'expose nulle part : ni entité (`StepVisibility` n'existe pas), ni
 * champ de projet sur `Step`, ni liste de valeurs dans le schéma contextualisé — vérifié
 * contre le site. À défaut, on écarte les homonymes, qui sont exactement ce que ce
 * réglage masque : un site accumule les étapes au fil des années, et ArtFX en a deux
 * nommées « art », deux « modeling ». Deux lignes qui se lisent pareil ne sont pas un
 * choix, c'est une devinette.
 *
 * Le nom ET le code court départagent : « lookdev/ldv » et « Look Development/ldv »
 * désignent la même étape pour qui la lit. La première l'emporte, et l'ordre a placé en
 * tête celles que le projet emploie déjà — donc celles qui sont sûrement les bonnes.
 */
export function dedupeSteps(steps: PipelineStep[]): PipelineStep[] {
  const seenCode = new Set<string>();
  const seenShort = new Set<string>();
  return steps.filter((s) => {
    const code = s.code.trim().toLowerCase();
    const short = s.shortName.trim().toLowerCase();
    if (seenCode.has(code) || (short && seenShort.has(short))) return false;
    seenCode.add(code);
    if (short) seenShort.add(short);
    return true;
  });
}

export interface ProjectMember {
  sgId: number;
  name: string;
  email: string | null;
  /** Identifiant local, quand cette personne a un compte ReView (rapprochement par e-mail). */
  userId: number | null;
}

/**
 * Personnes affectées à ce projet sur le site.
 *
 * Le studio en compte des centaines ; le projet, quelques-unes. Proposer l'annuaire
 * entier pour assigner une tâche revient à ne rien proposer du tout.
 */
export async function listProjectMembers(projectId: number): Promise<ProjectMember[]> {
  const ctx = await openConnection(projectId);
  const project = await ctx.client.findById('Project', ctx.connection.sgProjectId, ['users']);
  const refs = Array.isArray(project?.users) ? project.users : [];
  const ids = refs.map((r) => asEntityRef(r)).filter((r): r is { id: number; type: string } => r !== null);
  if (ids.length === 0) return [];

  const people = await ctx.client.search('HumanUser', {
    fields: ['name', 'email', 'login'],
    filters: [['id', 'in', ids.map((r) => r.id)]],
    sort: 'name',
  });

  // Le compte local, quand il existe : assigner dans ShotGrid ET dans ReView d'un geste.
  const emails = people.map((p) => (asString(p.email) ?? '').toLowerCase()).filter(Boolean);
  const locals = emails.length
    ? await prisma.user.findMany({ where: { email: { in: emails } }, select: { id: true, email: true } })
    : [];
  const byEmail = new Map(locals.map((u) => [u.email.toLowerCase(), u.id]));

  return people.map((p) => {
    const email = asString(p.email);
    return {
      sgId: p.id,
      name: asString(p.name) ?? asString(p.login) ?? `#${p.id}`,
      email,
      userId: email ? (byEmail.get(email.toLowerCase()) ?? null) : null,
    };
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
  params: {
    stepSgId: number;
    parentType: 'asset' | 'shot';
    parentId: number;
    name?: string;
    /** Personne à qui confier la tâche, choisie parmi les membres du projet. */
    assigneeSgId?: number | null;
  },
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

  // L'assignation n'accepte qu'une personne du projet : proposer l'annuaire du studio
  // permettrait de confier une tâche à quelqu'un qui n'y travaille pas.
  let assignee: ProjectMember | null = null;
  if (params.assigneeSgId) {
    const members = await listProjectMembers(projectId);
    assignee = members.find((m) => m.sgId === params.assigneeSgId) ?? null;
    if (!assignee) throw badRequest('Cette personne ne fait pas partie du projet');
  }

  const created = await ctx.client.create('Task', {
    project: { type: 'Project', id: ctx.connection.sgProjectId },
    content: name,
    step: { type: 'Step', id: params.stepSgId },
    entity: { type: parentLink.sgType, id: parentLink.sgId },
    ...(assignee ? { task_assignees: [{ type: 'HumanUser', id: assignee.sgId }] } : {}),
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
      ...(assignee?.userId ? { assigneeId: assignee.userId } : {}),
      ...(params.parentType === 'asset' ? { assetId: params.parentId } : { shotId: params.parentId }),
    },
  });

  await upsertLink({
    connectionId: ctx.connection.id,
    localType: 'task',
    localId: task.id,
    sgType: 'Task',
    sgId: created.id,
    data: {
      stepName: department,
      sgAssignees: assignee ? [{ id: assignee.sgId, name: assignee.name, email: assignee.email }] : [],
      sgStatusCode: null,
      durationMinutes: null,
    },
  });

  logger.info({ projectId, taskId: task.id, sgId: created.id, actorEmail }, 'Task créée depuis une étape');
  return { taskId: task.id, sgId: created.id, name };
}

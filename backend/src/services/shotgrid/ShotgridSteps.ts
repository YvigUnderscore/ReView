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
import { resolveForTask } from '../DepartmentService';

/**
 * Pipeline steps ("Pipeline Steps") of a ShotGrid site.
 *
 * An asset that has no task yet is nonetheless ready to receive one: the site knows the steps it goes through — art, modeling, rigging, groom, lookdev — long before a
 * task exists for each. Offering them makes it possible to drop a render under the right step without leaving ReView, where one previously had to go and create the task
 * by hand in ShotGrid, then come back and resynchronize.
 *
 * `Step` is global to the site — it carries no field linking it to a project, and `task_templates` is empty at this studio. But a "project" step is read elsewhere:
 * in the tasks that already exist there. They are authoritative, for a concrete reason: a site accumulates homonyms, and the "modeling" step used by this project carries
 * identifier 14 when the catalogue offers another under 1584. Choosing the wrong one files the task somewhere other than where the team looks for it.
 */

export interface PipelineStep {
  sgId: number;
  code: string;
  shortName: string;
  entityType: 'Asset' | 'Shot';
  color: string | null;
  order: number;
    /** Does a task of the project already carry this step? */
  used: boolean;
}

/** `25,118,27` (ShotGrid decimal RGB) -> `#19761B`. */
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

    // What the studio declared for this project: the only list that is authoritative, since the site does not publish its own visibility. It takes precedence over any deduction.
  const declared = ctx.settings.steps?.[entityType === 'Asset' ? 'asset' : 'shot'] ?? [];

    // What the project uses: the steps carried by its tasks, with THEIR identifiers.
  const projectTasks = await ctx.client.search('Task', {
    fields: ['step', 'entity'],
    filters: [projectFilter(ctx.connection.sgProjectId)],
    sort: 'id',
  });
  const inProject = new Map<number, string>();
  for (const task of projectTasks) {
    const ref = asEntityRef(task.step);
    const parent = asEntityRef(task.entity);
        // An asset step is not offered on a shot, and vice versa.
    if (ref && parent?.type === entityType) inProject.set(ref.id, ref.name ?? `step-${ref.id}`);
  }

  const wanted =
    options.all || (declared.length === 0 && inProject.size === 0)
      ? null
      : new Set(declared.length > 0 ? declared : inProject.keys());

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

    // The full catalogue is never de-duplicated: it is the list from which the studio chooses, and homonyms are precisely what it must tell apart. ArtFX has eight asset
    // steps whose name contains "model", and the one this project uses — "modeling", short code "model" — comes after its homonym in the site's order. Excluding it made it
    // impossible to tick.
  if (options.all) return steps;

    // A declared list is a choice, not a guess: we return it as is.
  return declared.length > 0 ? steps : dedupeSteps(steps);
}

/**
 * One step per name, one step per short code.
 *
 * ShotGrid restricts the proposed steps to those whose visibility is enabled in the project, but exposes it nowhere: neither entity (`StepVisibility` does not exist),
 * nor a project field on `Step`, nor a value list in the contextual schema — verified against the site. Failing that, we discard the homonyms, which are exactly what this
 * setting masks in practice on a site that accumulates steps over the years: ArtFX has two named "art" and two "modeling". Two lines that read the same are not a choice,
 * they are a guess.
 *
 * The name AND the short code break ties: "lookdev/ldv" and "Look Development/ldv" designate the same step for whoever reads it. The first wins, and the order has
 * placed at the head those the project already uses — hence those that are surely the right ones.
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
    /** Local identifier, when this person has a ReView account (matching by e-mail). */
  userId: number | null;
}

/**
 * People assigned to this project on the site.
 *
 * The studio counts hundreds of them; the project, a few. Offering the whole directory to assign a task amounts to offering nothing at all.
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

    // The local account, when it exists: assign in ShotGrid AND in ReView in one gesture.
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
 * Creates the missing task, first on ShotGrid then here.
 *
 * The order matters: the site is authoritative, and a task created locally first would be an orphan — `pullTasks` would never take it back for lack of a link, and the
 * remote trash would not reach it either. We therefore write there, then fetch the task back with its identifier, like any imported task.
 */
export async function createTaskFromStep(
  projectId: number,
  params: {
    stepSgId: number;
    parentType: 'asset' | 'shot';
    parentId: number;
    name?: string;
        /** Person to whom the task is entrusted, chosen among the project's members. */
    assigneeSgId?: number | null;
  },
  actorEmail: string | null,
): Promise<{ taskId: number; sgId: number; name: string }> {
  const ctx = await openConnection(projectId);
  if (!can(ctx.settings, 'tasks', 'write')) throw forbidden('Writing tasks is off for this project');

  const parentLink = await prisma.shotgridLink.findFirst({
    where: { connectionId: ctx.connection.id, localType: params.parentType, localId: params.parentId },
    select: { sgId: true, sgType: true },
  });
  if (!parentLink) throw badRequest('This entity does not exist in ShotGrid');

  const step = await ctx.client.findById('Step', params.stepSgId, ['code', 'short_name', 'entity_type']);
  if (!step) throw badRequest('Unknown pipeline step');

  const name = params.name?.trim() || asString(step.code) || `step-${params.stepSgId}`;

    // The assignment only accepts a person from the project: offering the studio's directory would allow entrusting a task to someone who does not work there.
  let assignee: ProjectMember | null = null;
  if (params.assigneeSgId) {
    const members = await listProjectMembers(projectId);
    assignee = members.find((m) => m.sgId === params.assigneeSgId) ?? null;
    if (!assignee) throw badRequest('This person is not a member of the project');
  }

    // The project and its re-reading are the business of `ShotgridWriter`: it sets the one, checks the other, and refuses a template project. Nothing to add here.
  const created = await ctx.writer.create('Task', {
    content: name,
    step: { type: 'Step', id: params.stepSgId },
    entity: { type: parentLink.sgType, id: parentLink.sgId },
    ...(assignee ? { task_assignees: [{ type: 'HumanUser', id: assignee.sgId }] } : {}),
  });

    // Belt and braces: we re-read what the site wrote and check that it is indeed the intended project, and not a template project. A misplaced task cannot be undone:
    // it appears in someone else's production.
  const check = await ctx.client.findById('Task', created.id, ['content', 'step', 'entity', 'project']);
  const scope = {
    sgProjectId: ctx.connection.sgProjectId,
    sgProjectName: ctx.connection.sgProjectName,
  };
  if (check && !belongsToProject(check, scope).ok) {
    logger.error({ projectId, sgId: created.id }, 'Task créée hors du projet lié — à retirer du site');
    throw badRequest('ShotGrid filed the task outside the target project');
  }
  if (check && !writeAllowedOn(check)) throw forbidden('ShotGrid template project — writing is refused');

    // The site's step becomes a department of the project — relation included. Writing only the string made the task invisible to assignment by department, which queries
    // the relation: it answered "create the task in ShotGrid first" although it had just been created there.
  const stepCode = asString(step.code) ?? null;
  const { department, departmentId } = await resolveForTask(projectId, stepCode);
  const task = await prisma.task.create({
    data: {
      name,
      type: sgStepToTaskType(stepCode),
      department,
      departmentId,
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
            // The link describes the remote side: it keeps the step name as the site writes it, not the normalized key of the local department.
      stepName: stepCode,
      sgAssignees: assignee ? [{ id: assignee.sgId, name: assignee.name, email: assignee.email }] : [],
      sgStatusCode: null,
      durationMinutes: null,
    },
  });

  logger.info({ projectId, taskId: task.id, sgId: created.id, actorEmail }, 'Task créée depuis une étape');
  return { taskId: task.id, sgId: created.id, name };
}

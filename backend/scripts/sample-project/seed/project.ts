// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Asset, PrismaClient, Project, Sequence, Shot, Task, User, Version } from '@prisma/client';
import type { PlannedProject, PlannedTask, PlannedVersion } from '../generate';
import { DEPARTMENTS } from '../data/team';
import type { ProjectSpec } from '../data/types';
import { seedPipelineStatuses, statusId, type StatusMap } from './statuses';
import type { SeededStudio } from './studio';

/**
 * Écriture de la structure d'un projet : hiérarchie, tâches, versions, fiches, assignations.
 *
 * Les médias et les fils de review viennent après (ils ont besoin des identifiants écrits
 * ici). Tout passe par Prisma plutôt que par l'API, pour une raison précise : les **dates**.
 * Un projet de démonstration crédible s'étale sur quatre mois — versions successives,
 * décisions espacées, retours d'il y a trois semaines — et aucune route ne permet
 * d'antidater ce qu'elle écrit.
 */

/** Version écrite en base, avec le plan qui l'a produite (les médias suivront). */
export interface SeededVersion {
  version: Version;
  planned: PlannedVersion;
  /** Code du plan ou nom de l'asset porteur, pour nommer les fichiers. */
  ownerCode: string;
  /** Plan porteur, quand la version appartient à un plan. */
  shot?: Shot;
  asset?: Asset;
  task: Task;
}

export interface SeededProject {
  spec: ProjectSpec;
  project: Project;
  statuses: StatusMap;
  sequences: Map<string, Sequence>;
  shots: Map<string, Shot>;
  assets: Map<string, Asset>;
  /** Toutes les versions écrites, dans l'ordre de création. */
  versions: SeededVersion[];
}

/** Identifiant utilisateur d'une clé de membre. */
const userId = (studio: SeededStudio, key: string): number => {
  const user = studio.users.get(key);
  if (!user) throw new Error(`unknown member: ${key}`);
  return user.id;
};

/** Fiche markdown d'une entité (une seule par entité). */
async function upsertNote(
  prisma: PrismaClient,
  projectId: number,
  target: { sequenceId?: number; shotId?: number; assetId?: number; episodeId?: number },
  body: string,
  updatedById: number,
): Promise<void> {
  const existing = await prisma.entityNote.findFirst({ where: { projectId, ...target } });
  if (existing) {
    await prisma.entityNote.update({ where: { id: existing.id }, data: { body, updatedById } });
    return;
  }
  await prisma.entityNote.create({ data: { projectId, ...target, body, updatedById } });
}

/** Crée les tâches et les versions d'un porteur (plan ou asset). */
async function writeTasks(
  prisma: PrismaClient,
  studio: SeededStudio,
  statuses: StatusMap,
  owner: { shot?: Shot; asset?: Asset; code: string },
  tasks: PlannedTask[],
  out: SeededVersion[],
): Promise<void> {
  for (const [order, planned] of tasks.entries()) {
    const departmentId = studio.departments.get(planned.department) ?? null;
    const where = owner.shot
      ? { shotId: owner.shot.id, departmentId, name: planned.name }
      : { assetId: owner.asset!.id, departmentId, name: planned.name };
    const existing = await prisma.task.findFirst({ where });
    const data = {
      type: planned.type,
      status: 'TODO' as const,
      pipelineStatusId: statusId(statuses, 'task', planned.statusCode),
      order,
      department: planned.department,
      departmentId,
      assigneeId: userId(studio, planned.assigneeKey),
      startDate: planned.startDate,
      dueDate: planned.dueDate,
      checklist: planned.checklist,
    };
    const task = existing
      ? await prisma.task.update({ where: { id: existing.id }, data })
      : await prisma.task.create({
          data: {
            ...data,
            name: planned.name,
            ...(owner.shot ? { shotId: owner.shot.id } : { assetId: owner.asset!.id }),
          },
        });

    // `status` (énumération) suit le statut personnalisé — les deux sont toujours écrits
    // ensemble, exactement comme le fait le service.
    const status = await prisma.pipelineStatus.findUnique({ where: { id: task.pipelineStatusId ?? -1 } });
    if (status?.legacyStatus) {
      await prisma.task.update({ where: { id: task.id }, data: { status: status.legacyStatus } });
    }

    for (const plannedVersion of planned.versions) {
      const existingVersion = await prisma.version.findFirst({
        where: { taskId: task.id, name: plannedVersion.name },
      });
      const versionData = {
        status: plannedVersion.status,
        published: plannedVersion.published,
        authorId: userId(studio, plannedVersion.authorKey),
        departmentId,
        createdAt: plannedVersion.createdAt,
      };
      const version = existingVersion
        ? await prisma.version.update({ where: { id: existingVersion.id }, data: versionData })
        : await prisma.version.create({
            data: { taskId: task.id, name: plannedVersion.name, ...versionData },
          });
      out.push({
        version,
        planned: plannedVersion,
        ownerCode: owner.code,
        ...(owner.shot ? { shot: owner.shot } : {}),
        ...(owner.asset ? { asset: owner.asset } : {}),
        task,
      });
    }
  }
}

export async function seedProject(
  prisma: PrismaClient,
  studio: SeededStudio,
  plan: PlannedProject,
): Promise<SeededProject> {
  const spec = plan.spec;
  const settings = {
    departments: spec.pipeline.map((key) => ({
      key,
      name: DEPARTMENTS.find((d) => d.key === key)?.name ?? key,
    })),
    nomenclature: { sequencePrefix: 'SQ', shotPrefix: 'SH', padding: 4, step: 10 },
    naming: spec.naming ?? { pattern: '', mode: 'off' },
    resolution: spec.resolution,
    framerate: spec.framerate,
  };

  const project = await prisma.project.upsert({
    where: { studioId_slug: { studioId: studio.studio.id, slug: spec.slug } },
    update: {
      name: spec.name,
      description: spec.description,
      status: spec.status,
      startFrame: spec.startFrame,
      episodesEnabled: spec.episodesEnabled === true,
      settings,
      deletedAt: null,
      ...(spec.storageQuotaGb ? { storageQuota: BigInt(spec.storageQuotaGb) * BigInt(1024 ** 3) } : {}),
    },
    create: {
      studioId: studio.studio.id,
      slug: spec.slug,
      name: spec.name,
      description: spec.description,
      status: spec.status,
      startFrame: spec.startFrame,
      episodesEnabled: spec.episodesEnabled === true,
      settings,
      ...(spec.storageQuotaGb ? { storageQuota: BigInt(spec.storageQuotaGb) * BigInt(1024 ** 3) } : {}),
    },
  });

  for (const member of spec.team) {
    const id = userId(studio, member.member);
    await prisma.projectMembership.upsert({
      where: { userId_projectId: { userId: id, projectId: project.id } },
      update: { role: member.role ?? null },
      create: { userId: id, projectId: project.id, role: member.role ?? null },
    });
  }

  const statuses = await seedPipelineStatuses(prisma, project.id);
  const adaId = userId(studio, 'ada');

  const episodes = new Map<string, number>();
  for (const [order, episode] of (spec.episodes ?? []).entries()) {
    const record = await prisma.episode.upsert({
      where: { projectId_code: { projectId: project.id, code: episode.code } },
      update: { name: episode.name, description: episode.description, order },
      create: {
        projectId: project.id,
        code: episode.code,
        name: episode.name,
        description: episode.description,
        order,
        pipelineStatusId: statusId(statuses, 'sequence', 'ip'),
      },
    });
    episodes.set(episode.code, record.id);
  }

  const sequences = new Map<string, Sequence>();
  for (const [order, sequence] of spec.sequences.entries()) {
    const record = await prisma.sequence.upsert({
      where: { projectId_code: { projectId: project.id, code: sequence.code } },
      update: {
        name: sequence.name,
        description: sequence.description,
        order,
        episodeId: sequence.episode ? (episodes.get(sequence.episode) ?? null) : null,
      },
      create: {
        projectId: project.id,
        code: sequence.code,
        name: sequence.name,
        description: sequence.description,
        order,
        episodeId: sequence.episode ? (episodes.get(sequence.episode) ?? null) : null,
        pipelineStatusId: statusId(statuses, 'sequence', 'ip'),
      },
    });
    sequences.set(sequence.code, record);

    const assigneeIds = (sequence.assignees ?? []).map((key) => ({ id: userId(studio, key) }));
    const departmentIds = spec.pipeline
      .map((key) => studio.departments.get(key))
      .filter((id): id is number => Boolean(id))
      .map((id) => ({ id }));
    await prisma.sequence.update({
      where: { id: record.id },
      data: { assignees: { set: assigneeIds }, departments: { set: departmentIds } },
    });
    if (sequence.brief) {
      await upsertNote(prisma, project.id, { sequenceId: record.id }, sequence.brief, adaId);
    }
  }

  const shots = new Map<string, Shot>();
  const versions: SeededVersion[] = [];
  for (const planned of plan.shots) {
    const sequence = sequences.get(planned.sequence.code)!;
    const frames = Math.round((planned.spec.duration ?? 5) * spec.framerate);
    const existing = await prisma.shot.findFirst({
      where: { projectId: project.id, sequenceId: sequence.id, code: planned.spec.code },
    });
    const data = {
      name: planned.spec.name,
      description: planned.spec.description,
      startFrame: spec.startFrame,
      endFrame: spec.startFrame + frames - 1,
      order: planned.sequence.shots.findIndex((s) => s.code === planned.spec.code) * 10,
      omitted: planned.spec.omitted === true,
      pipelineStatusId: statusId(statuses, 'shot', planned.statusCode),
      deletedAt: null,
    };
    const shot = existing
      ? await prisma.shot.update({ where: { id: existing.id }, data })
      : await prisma.shot.create({
          data: { projectId: project.id, sequenceId: sequence.id, code: planned.spec.code, ...data },
        });
    shots.set(planned.spec.code, shot);

    await prisma.shot.update({
      where: { id: shot.id },
      data: {
        assignees: { set: (planned.spec.assignees ?? []).map((key) => ({ id: userId(studio, key) })) },
        departments: {
          set: planned.tasks
            .map((t) => studio.departments.get(t.department))
            .filter((id): id is number => Boolean(id))
            .map((id) => ({ id })),
        },
      },
    });
    if (planned.spec.brief) {
      await upsertNote(prisma, project.id, { shotId: shot.id }, planned.spec.brief, adaId);
    }
    await writeTasks(prisma, studio, statuses, { shot, code: planned.spec.code }, planned.tasks, versions);
  }

  const assets = new Map<string, Asset>();
  for (const planned of plan.assets) {
    const asset = await prisma.asset.upsert({
      where: { projectId_name: { projectId: project.id, name: planned.spec.name } },
      update: {
        type: planned.spec.type,
        typeLabel: planned.spec.typeLabel ?? null,
        description: planned.spec.description,
        pipelineStatusId: statusId(statuses, 'asset', planned.statusCode),
        deletedAt: null,
      },
      create: {
        projectId: project.id,
        name: planned.spec.name,
        type: planned.spec.type,
        typeLabel: planned.spec.typeLabel ?? null,
        description: planned.spec.description,
        pipelineStatusId: statusId(statuses, 'asset', planned.statusCode),
      },
    });
    assets.set(planned.spec.key, asset);

    await prisma.asset.update({
      where: { id: asset.id },
      data: {
        assignees: { set: (planned.spec.assignees ?? []).map((key) => ({ id: userId(studio, key) })) },
        departments: {
          set: planned.tasks
            .map((t) => studio.departments.get(t.department))
            .filter((id): id is number => Boolean(id))
            .map((id) => ({ id })),
        },
      },
    });
    if (planned.spec.brief) {
      await upsertNote(prisma, project.id, { assetId: asset.id }, planned.spec.brief, adaId);
    }
    await writeTasks(
      prisma,
      studio,
      statuses,
      { asset, code: planned.spec.name.replace(/\s+/g, '') },
      planned.tasks,
      versions,
    );
  }

  // Liens asset ↔ plan : « cet asset apparaît dans ce plan », ce que la fiche d'un asset
  // affiche et ce dont le montage se sert pour retrouver les plans concernés.
  for (const planned of plan.shots) {
    const shot = shots.get(planned.spec.code)!;
    const used = (planned.spec.assets ?? [])
      .map((key) => assets.get(key))
      .filter((asset): asset is Asset => Boolean(asset));
    if (used.length === 0) continue;
    await prisma.shot.update({
      where: { id: shot.id },
      data: { assets: { set: used.map((asset) => ({ id: asset.id })) } },
    });
  }

  return { spec, project, statuses, sequences, shots, assets, versions };
}

/** Membres du projet, par clé — utilisé par les étapes suivantes. */
export const projectMembers = (spec: ProjectSpec, studio: SeededStudio): Map<string, User> => {
  const map = new Map<string, User>();
  for (const member of spec.team) {
    const user = studio.users.get(member.member);
    if (user) map.set(member.member, user);
  }
  return map;
};

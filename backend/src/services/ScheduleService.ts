import { TaskStatus, TaskType } from '@prisma/client';
import { prisma } from '../lib/prisma';

/**
 * Planning projet (43.C — №125/№128) : tâches datées (échéance et/ou début) pour la vue
 * calendrier et le Gantt par séquence. Lecture seule ; l'édition des dates passe par le
 * PATCH /api/tasks/:id existant (superviseurs).
 */

export interface ScheduleTask {
  id: number;
  name: string;
  type: TaskType;
  status: TaskStatus;
  startDate: string | null;
  dueDate: string | null;
  location: string;
  sequenceId: number | null;
  sequenceCode: string | null;
  assignee: { id: number; name: string | null } | null;
}

export interface ProjectSchedule {
  tasks: ScheduleTask[];
}

/** Ligne brute (sortie du select Prisma) → tâche de planning (fonction pure, testée). */
export interface ScheduleRow {
  id: number;
  name: string;
  type: TaskType;
  status: TaskStatus;
  startDate: Date | null;
  dueDate: Date | null;
  assignee: { id: number; name: string | null } | null;
  shot: { code: string; sequence: { id: number; code: string } | null } | null;
  asset: { name: string } | null;
}

export function toScheduleTask(t: ScheduleRow): ScheduleTask {
  const seq = t.shot?.sequence ?? null;
  const location = t.shot ? `${seq ? seq.code + ' · ' : ''}${t.shot.code}` : (t.asset?.name ?? '');
  return {
    id: t.id,
    name: t.name,
    type: t.type,
    status: t.status,
    startDate: t.startDate ? t.startDate.toISOString() : null,
    dueDate: t.dueDate ? t.dueDate.toISOString() : null,
    location,
    sequenceId: seq?.id ?? null,
    sequenceCode: seq?.code ?? null,
    assignee: t.assignee ? { id: t.assignee.id, name: t.assignee.name } : null,
  };
}

/** Tâches du projet ayant au moins une date (début ou échéance), triées par échéance. */
export async function getProjectSchedule(projectId: number): Promise<ProjectSchedule> {
  const rows = await prisma.task.findMany({
    where: {
      AND: [
        { OR: [{ startDate: { not: null } }, { dueDate: { not: null } }] },
        {
          OR: [{ shot: { projectId, deletedAt: null } }, { asset: { projectId, deletedAt: null } }],
        },
      ],
    },
    select: {
      id: true,
      name: true,
      type: true,
      status: true,
      startDate: true,
      dueDate: true,
      assignee: { select: { id: true, name: true } },
      shot: { select: { code: true, sequence: { select: { id: true, code: true } } } },
      asset: { select: { name: true } },
    },
    orderBy: [{ dueDate: 'asc' }, { startDate: 'asc' }],
  });

  return { tasks: rows.map(toScheduleTask) };
}

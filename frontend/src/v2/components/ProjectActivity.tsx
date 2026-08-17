// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileVideo, Layers, Clock } from 'lucide-react';
import { api } from '../../lib/apiClient';
import { qk } from '../lib/query';
import {
  TASK_STATUSES as STATUS,
  TASK_STATUS_LABEL_KEY as STATUS_LABEL,
  TASK_STATUS_COLOR as STATUS_COLOR,
  TASK_STATUS_BAR as STATUS_BAR,
  TASK_STATUS_PRIORITY as PRIORITY,
} from '../lib/taskStatus';
import type { Membership, TaskStatus, TaskWithAssignee } from '../types/api';
import { useT } from '../i18n';
import PipelineStatusSelect from './shotgrid/PipelineStatusSelect';

interface RecentItem {
  type: 'version' | 'media';
  id: number;
  at: string;
  label: string;
  location: string;
  author: string | null;
  kind?: string;
  taskId?: number | null;
  mediaId?: number;
  versionId?: number;
}
type ActTask = TaskWithAssignee & { location: string; pipelineStatusId?: number | null };

interface Activity {
  recent: RecentItem[];
  tasks: ActTask[];
}

export default function ProjectActivity({ projectId, canManage }: { projectId: number; canManage: boolean }) {
  const tr = useT();
  const qc = useQueryClient();
  const { data, error } = useQuery({
    queryKey: qk.projectActivity(projectId),
    queryFn: () => api.get<Activity>(`/api/projects/${projectId}/activity`),
  });
  const recent = data?.recent ?? [];
  const tasks = useMemo(
    () => [...(data?.tasks ?? [])].sort((a, b) => (PRIORITY[a.status] ?? 9) - (PRIORITY[b.status] ?? 9)),
    [data],
  );
  const { data: projData } = useQuery({
    queryKey: qk.project(projectId),
    queryFn: () => api.get<{ project: { memberships: Membership[] } }>(`/api/projects/${projectId}`),
    enabled: canManage,
  });
  const members = projData?.project.memberships ?? [];

  // Mise à jour optimiste du cache ; rollback par invalidation si le PATCH échoue.
  const patchTask = (taskId: number, patch: Partial<ActTask>) =>
    qc.setQueryData<Activity>(qk.projectActivity(projectId), (old) =>
      old ? { ...old, tasks: old.tasks.map((t) => (t.id === taskId ? { ...t, ...patch } : t)) } : old,
    );
  const rollback = () => qc.invalidateQueries({ queryKey: qk.projectActivity(projectId) });

  // Les deux valeurs avancent ensemble : le référentiel porte le vocabulaire du site,
  // l'énumération reste ce sur quoi s'appuient le kanban, les statistiques et l'API v1.
  const setStatus = async (taskId: number, next: { statusId: number | null; legacyStatus: TaskStatus }) => {
    patchTask(taskId, { status: next.legacyStatus, pipelineStatusId: next.statusId });
    try {
      await api.patch(`/api/tasks/${taskId}`, {
        status: next.legacyStatus,
        ...(next.statusId ? { pipelineStatusId: next.statusId } : {}),
      });
    } catch {
      void rollback();
    }
  };
  const assign = async (taskId: number, assigneeId: string) => {
    const id = assigneeId ? Number(assigneeId) : null;
    const member = members.find((m) => m.user.id === id);
    patchTask(taskId, { assignee: id ? { id, name: member?.user.name ?? null } : null });
    try {
      await api.patch(`/api/tasks/${taskId}`, { assigneeId: id });
    } catch {
      void rollback();
    }
  };

  // Répartition des tâches par statut (jauge de progression — 10.C1) ;
  // suit les mises à jour optimistes de statut ci-dessous.
  const byStatus = STATUS.map((s) => ({ status: s, count: tasks.filter((t) => t.status === s).length }));
  const total = tasks.length;

  return (
    <div className="mt-6 space-y-4">
      {total > 0 && (
        <section className="rounded-lg border border-border bg-card p-4">
          <h3 className="mb-3 text-sm font-semibold">{tr('activity.title')}</h3>
          <div className="flex h-2.5 overflow-hidden rounded-full bg-secondary/40">
            {byStatus
              .filter((b) => b.count > 0)
              .map((b) => (
                <div
                  key={b.status}
                  title={`${tr(STATUS_LABEL[b.status])} : ${b.count}`}
                  className={`${STATUS_BAR[b.status] ?? 'bg-muted-foreground/40'} transition-all`}
                  style={{ width: `${(b.count / total) * 100}%` }}
                />
              ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {byStatus
              .filter((b) => b.count > 0)
              .map((b) => (
                <span key={b.status} className="flex items-center gap-1.5">
                  <span
                    className={`h-2 w-2 rounded-full ${STATUS_BAR[b.status] ?? 'bg-muted-foreground/40'}`}
                  />
                  {tr(STATUS_LABEL[b.status])} · {b.count}
                </span>
              ))}
          </div>
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Dernières mises à jour */}
        <section className="rounded-lg border border-border bg-card p-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Clock size={15} /> {tr('home.recentActivity')}
          </h3>
          {error && <p className="text-xs text-destructive">{error.message}</p>}
          {recent.length === 0 ? (
            <p className="text-xs text-muted-foreground">{tr('activity.empty')}</p>
          ) : (
            <ul className="space-y-1.5">
              {recent.map((r) => {
                const to =
                  r.type === 'media' ? `/review/${r.mediaId}` : r.taskId ? `/tasks/${r.taskId}` : '#';
                return (
                  <li key={`${r.type}-${r.id}`}>
                    <Link
                      to={to}
                      className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-secondary/60"
                    >
                      {r.type === 'media' ? (
                        <FileVideo size={14} className="shrink-0 text-primary" />
                      ) : (
                        <Layers size={14} className="shrink-0 text-muted-foreground" />
                      )}
                      <span className="min-w-0 flex-1 truncate">
                        {r.location && <span className="text-muted-foreground">{r.location} · </span>}
                        <span className="font-medium">{r.label}</span>
                      </span>
                      <span className="shrink-0 text-2xs text-muted-foreground">
                        {new Date(r.at).toLocaleDateString()}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Tâches à traiter (priorité par statut) + statut/assignation */}
        <section className="rounded-lg border border-border bg-card p-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Layers size={15} /> {tr('activity.title')}
          </h3>
          {tasks.length === 0 ? (
            <p className="text-xs text-muted-foreground">{tr('activity.noTask')}</p>
          ) : (
            <ul className="space-y-1.5">
              {tasks.slice(0, 25).map((t) => (
                <li
                  key={t.id}
                  className="flex flex-wrap items-center gap-2 rounded-md border border-border/60 bg-background px-2 py-1.5 text-xs"
                >
                  <Link to={`/tasks/${t.id}`} className="min-w-0 flex-1 truncate hover:text-primary">
                    {t.location && <span className="text-muted-foreground">{t.location} · </span>}
                    <span className="font-medium">{t.name}</span>
                  </Link>
                  {canManage ? (
                    <>
                      <PipelineStatusSelect
                        projectId={projectId}
                        scope="task"
                        statusId={t.pipelineStatusId}
                        legacyStatus={t.status}
                        onChange={(next) => setStatus(t.id, next)}
                      />
                      <select
                        value={t.assignee?.id ?? ''}
                        onChange={(e) => assign(t.id, e.target.value)}
                        className="rounded border border-input bg-background px-1 py-0.5 text-xs"
                      >
                        <option value="">{tr('activity.unassigned')}</option>
                        {members.map((m) => (
                          <option key={m.user.id} value={m.user.id}>
                            {m.user.name ?? m.user.email}
                          </option>
                        ))}
                      </select>
                    </>
                  ) : (
                    <>
                      <span className={`rounded px-1.5 py-0.5 text-xs ${STATUS_COLOR[t.status] ?? ''}`}>
                        {STATUS_LABEL[t.status] ? tr(STATUS_LABEL[t.status]) : t.status}
                      </span>
                      {t.assignee && <span className="text-xs text-muted-foreground">{t.assignee.name}</span>}
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

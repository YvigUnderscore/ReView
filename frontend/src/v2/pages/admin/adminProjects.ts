// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { AdminProjectRow, PipelineSettings, ProjectStatus } from '../../types/api';
import { t } from '../../i18n';

/** Pure helpers for the Projects admin pages — tested. */

/** Display order of statuses — safe to freeze, these are not labels. */
export const PROJECT_STATUSES: ProjectStatus[] = ['ACTIVE', 'ON_HOLD', 'COMPLETED', 'ARCHIVED'];

/**
 * Project status labels, as a function rather than a constant: a table evaluated at
 * module load would freeze the language at import, before the catalogue arrives.
 */
export function projectStatusLabels(tr: typeof t): Record<ProjectStatus, string> {
  return {
    ACTIVE: tr('project.status.active'),
    ON_HOLD: tr('project.status.onHold'),
    COMPLETED: tr('project.status.completed'),
    ARCHIVED: tr('project.status.archived'),
  };
}

/** Full-text filter (name, slug) + status. */
export function filterProjects(
  projects: AdminProjectRow[],
  q: string,
  status: ProjectStatus | 'ALL',
): AdminProjectRow[] {
  const needle = q.trim().toLowerCase();
  return projects.filter((p) => {
    if (status !== 'ALL' && p.status !== status) return false;
    if (!needle) return true;
    return p.name.toLowerCase().includes(needle) || p.slug.toLowerCase().includes(needle);
  });
}

/** Percentage of quota consumed (0–100, clamped); null if there is no quota. */
export function quotaPct(usage: number, quota: number | null): number | null {
  if (quota == null || quota <= 0) return null;
  return Math.min(100, Math.round((usage / quota) * 100));
}

/** Compact label of an effective pipeline: "1920×1080 · 24 fps". */
export function pipelineLabel(p: PipelineSettings): string {
  return `${p.resolution.width}×${p.resolution.height} · ${p.framerate} fps`;
}

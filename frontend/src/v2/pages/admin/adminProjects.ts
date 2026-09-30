// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { AdminProjectRow, PipelineSettings, ProjectStatus } from '../../types/api';
import { t } from '../../i18n';

/** Helpers purs des pages admin Projets — testés. */

/** Ordre d'affichage des statuts — sûr à figer, ce ne sont pas des libellés. */
export const PROJECT_STATUSES: ProjectStatus[] = ['ACTIVE', 'ON_HOLD', 'COMPLETED', 'ARCHIVED'];

/**
 * Libellés de statut de projet, en fonction et non en constante : une table évaluée au
 * chargement du module fige la langue à l'import, avant l'arrivée du catalogue.
 */
export function projectStatusLabels(tr: typeof t): Record<ProjectStatus, string> {
  return {
    ACTIVE: tr('project.status.active'),
    ON_HOLD: tr('project.status.onHold'),
    COMPLETED: tr('project.status.completed'),
    ARCHIVED: tr('project.status.archived'),
  };
}

/** Filtre plein-texte (nom, slug) + statut. */
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

/** Pourcentage de quota consommé (0–100, borné) ; null si pas de quota. */
export function quotaPct(usage: number, quota: number | null): number | null {
  if (quota == null || quota <= 0) return null;
  return Math.min(100, Math.round((usage / quota) * 100));
}

/** Libellé compact d'un pipeline effectif : « 1920×1080 · 24 ips ». */
export function pipelineLabel(p: PipelineSettings): string {
  return `${p.resolution.width}×${p.resolution.height} · ${p.framerate} fps`;
}

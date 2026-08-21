// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { AssetType, PipelineOverride, ProjectStatus } from './api';

/**
 * Entités du pipe : projet, séquence, plan, asset.
 *
 * Extraites de `api.ts` en C3, quand la fiche de séquence et celle d'asset ont grossi :
 * le module d'entrée dépassait son budget de lignes. La règle ne change pas — une entité,
 * une définition, composée par `Pick`/intersection et jamais redéclarée.
 */

export interface Project {
  id: number;
  name: string;
  description: string | null;
  status: ProjectStatus;
  thumbnailUrl: string | null;
}
export type ProjectRef = Pick<Project, 'id' | 'name'>;

export interface Sequence {
  id: number;
  code: string;
  name: string;
  order: number;
  projectId?: number;
  /** Fiche de la séquence (C3) — un plan et un asset en avaient une, pas elle. */
  description?: string | null;
  thumbnailUrl?: string | null;
  pipelineStatusId?: number | null;
  /** Override pipeline (résolution/fps) hérité du projet — Phase 18/19. */
  settings?: PipelineOverride;
}
export type SequenceRef = Pick<Sequence, 'id' | 'code' | 'name'>;
/** GET /api/sequences?projectId= */
export type SequenceSummary = Sequence & { _count: { shots: number } };

export interface Shot {
  id: number;
  code: string;
  name: string;
  sequenceId: number | null;
  startFrame?: number | null;
  endFrame?: number | null;
  /** Fiche du plan (C3) : un asset en avait une, pas un plan. */
  description?: string | null;
  pipelineStatusId?: number | null;
  thumbnailUrl?: string | null;
  /** Override pipeline (résolution/fps) hérité séquence→projet — Phase 18/19. */
  settings?: PipelineOverride;
  /** Coupé au montage (Phase 45) : sauté par les timelines, conservé partout ailleurs. */
  omitted?: boolean;
}
export type ShotRef = Pick<Shot, 'id' | 'code' | 'name'>;
/** GET /api/shots?projectId= */
/** Étape du pipe, telle que les listes la renvoient. */
export interface DepartmentRef {
  id: number;
  key: string;
  name: string;
  color?: string | null;
}

export type ShotSummary = Shot & {
  _count?: { tasks: number };
  assets?: AssetRef[];
  /** Étapes que le plan traverse — le filtre par département s'appuie dessus. */
  departments?: DepartmentRef[];
};

export interface Asset {
  id: number;
  name: string;
  type: AssetType;
  /** Libellé du type tel que le studio le nomme (Phase 48, éditable depuis C3). */
  typeLabel?: string | null;
  description?: string | null;
  thumbnailUrl?: string | null;
}
export type AssetRef = Pick<Asset, 'id' | 'name' | 'type'>;
/**
 * GET /api/assets — la liste porte les étapes et les assignés, pour que le menu
 * contextuel d'une carte sache quoi cocher sans une requête par carte affichée.
 */
export type AssetListItem = Asset & {
  departments?: DepartmentRef[];
  tasks?: {
    id: number;
    departmentId: number | null;
    /** Le département de la tâche, nommé — il peut ne pas figurer dans `departments`. */
    departmentRef?: { id: number; name: string } | null;
    assignee: { id: number; name: string } | null;
  }[];
};
/** GET /api/assets/:id — liens N-N vers shots/séquences, plus la fiche (C3). */
export type AssetDetail = Asset & {
  projectId: number;
  shots: (ShotRef & { sequenceId: number | null })[];
  sequences: SequenceRef[];
  departments?: { id: number; key: string; name: string; color?: string | null }[];
};

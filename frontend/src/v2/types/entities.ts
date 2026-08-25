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

/**
 * Une personne assignée, telle que les cartes la reçoivent.
 *
 * `avatarUrl` est déjà signée par le serveur : une grille de deux cents plans porte deux
 * cents fois les mêmes dix visages, et les signer côté client aurait demandé deux cents
 * allers-retours pour dix objets distincts.
 */
export interface AssigneeRef {
  id: number;
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  avatarUrl: string | null;
}

/**
 * Ce qu'une carte de séquence, de plan ou d'asset affiche en plus de son nom.
 *
 * Les trois listes partagent exactement ces champs : les définir une fois est ce qui
 * garantit qu'une carte de plan et une carte d'asset ne divergeront pas d'un écran à
 * l'autre — c'était le cas jusqu'ici, faute de type commun.
 */
export interface EntityCardExtras {
  /** Personnes responsables de l'entité elle-même (distinctes des assignés de tâche). */
  assignees?: AssigneeRef[];
  /** Livraisons publiées qu'aucune décision de review n'a tranchées. */
  awaitingReview?: number;
  /** Dernière modification (ISO) — « ça n'a pas bougé depuis trois semaines ». */
  updatedAt?: string;
}

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
  /**
   * Épisode d'appartenance (niveau facultatif par projet, éteint par défaut).
   * `null`/absent = séquence hors épisode — l'état normal d'un long-métrage.
   */
  episodeId?: number | null;
}
export type SequenceRef = Pick<Sequence, 'id' | 'code' | 'name'>;
/** GET /api/sequences?projectId= */
export type SequenceSummary = Sequence & EntityCardExtras & { _count: { shots: number } };

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

export type ShotSummary = Shot &
  EntityCardExtras & {
    _count?: { tasks: number };
    assets?: AssetRef[];
    /** Étapes que le plan traverse — le filtre par département s'appuie dessus. */
    departments?: DepartmentRef[];
  };

export interface Asset {
  id: number;
  name: string;
  type: AssetType;
  /** Statut d'asset (Phase 48 : le site en tient une liste propre, distincte des tâches). */
  pipelineStatusId?: number | null;
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
export type AssetListItem = Asset &
  EntityCardExtras & {
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

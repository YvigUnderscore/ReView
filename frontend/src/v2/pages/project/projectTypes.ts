// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { AssetRef, AssetType, SequenceRef, ShotRef, TaskType } from '../../types/api';

/** Types et constantes partagés des onglets de ProjectPage (découpage 10.C1). */

// Entités API : définitions canoniques dans types/api (10.E2) — ré-exports nommés du domaine projet.
export type {
  Nomenclature,
  Department,
  ProjectSettings,
  Task,
  AssetRef,
  Membership as Member,
  SequenceSummary as Sequence,
  ShotSummary as Shot,
  Asset,
} from '../../types/api';

/**
 * GET /api/sequences/:id — fiche complète d'une séquence (C3).
 *
 * Les plans arrivent avec de quoi les reconnaître (vignette, statut, plage de frames)
 * plutôt qu'en simple liste de codes : c'est ce que sert la page de séquence.
 */
export type SequenceDetailData = SequenceRef & {
  projectId: number;
  description?: string | null;
  thumbnailUrl?: string | null;
  pipelineStatusId?: number | null;
  shots: (ShotRef & {
    assets: AssetRef[];
    thumbnailUrl?: string | null;
    pipelineStatusId?: number | null;
    startFrame?: number | null;
    endFrame?: number | null;
    omitted?: boolean;
    _count?: { tasks: number };
  })[];
  assets: (AssetRef & { typeLabel?: string | null; thumbnailUrl?: string | null })[];
  departments?: { id: number; key: string; name: string; color?: string | null }[];
};

export const ASSET_TYPES: readonly AssetType[] = [
  'CHARACTER',
  'PROP',
  'ENVIRONMENT',
  'VEHICLE',
  'FX',
  'OTHER',
];
export const TASK_TYPES: readonly TaskType[] = [
  'ANIMATION',
  'FX',
  'COMPOSITING',
  'LIGHTING',
  'MODELING',
  'RIGGING',
  'LOOKDEV',
  'LAYOUT',
  'OTHER',
];

/** Tri par ordre puis par code (numérique : SQ001 < SQ002 < SQ010). */
export function sortByCode<T extends { order: number; code: string }>(items: T[]): T[] {
  return [...items].sort(
    (a, b) => a.order - b.order || a.code.localeCompare(b.code, undefined, { numeric: true }),
  );
}

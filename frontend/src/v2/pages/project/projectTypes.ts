// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { AssetRef, AssetType, EpisodeRef, SequenceRef, ShotRef, TaskType } from '../../types/api';
import type { EntityCardExtras } from '../../types/entities';

/** Shared types and constants of the ProjectPage tabs (split 10.C1). */

// API entities: canonical definitions in types/api (10.E2), named re-exports of the project domain.
export type {
  Nomenclature,
  Department,
  DepartmentSummary,
  ProjectSettings,
  Task,
  AssetRef,
  Membership as Member,
  SequenceSummary as Sequence,
  ShotSummary as Shot,
  Asset,
} from '../../types/api';

/**
 * GET /api/sequences/:id: full sheet of a sequence (C3).
 *
 * The shots arrive with what is needed to recognize them (thumbnail, status, frame range), rather
 * than as a bare list of codes: that is what the sequence page serves.
 */
export type SequenceDetailData = SequenceRef & {
  projectId: number;
  /**
   * Episode the sequence belongs to (optional level, off by default): `null` on a feature film, and
   * the page then shows nothing more.
   */
  episode?: EpisodeRef | null;
  description?: string | null;
  thumbnailUrl?: string | null;
  pipelineStatusId?: number | null;
  shots: (ShotRef &
    EntityCardExtras & {
      assets: AssetRef[];
      thumbnailUrl?: string | null;
      pipelineStatusId?: number | null;
      startFrame?: number | null;
      endFrame?: number | null;
      description?: string | null;
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

/** Sort by order, then by code (numeric: SQ001 < SQ002 < SQ010). */
export function sortByCode<T extends { order: number; code: string }>(items: T[]): T[] {
  return [...items].sort(
    (a, b) => a.order - b.order || a.code.localeCompare(b.code, undefined, { numeric: true }),
  );
}

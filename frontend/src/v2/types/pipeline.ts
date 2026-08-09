// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

// Pipe ordonné, espace asset et montages automatiques (Phase 45) — module séparé du
// budget de lignes d'api.ts. Miroir des sorties de `PipelineLatestService` et
// `TimelineService` côté backend.
import type { Department, MediaKind, ReviewStatus, UserRef, VersionStatus } from './api';

/** Média tel que l'API le renvoie : URL signée, jamais de clé de stockage. */
export interface PipelineMedia {
  id: number;
  kind: MediaKind;
  originalName: string;
  mimeType: string;
  createdAt: string;
  thumbnailUrl: string | null;
}

/** Groupe d'affichage ordonné par le pipe ; `key` null = fourre-tout de fin de liste. */
export interface DepartmentGroup<T> {
  key: string | null;
  name: string;
  rank: number;
  items: T[];
}

export interface AssetTreeVersion {
  id: number;
  name: string;
  status: VersionStatus;
  published: boolean;
  createdAt: string;
  author: UserRef | null;
  reviewStatus: Pick<ReviewStatus, 'id' | 'name' | 'color'> | null;
  media: PipelineMedia[];
}

/** Une tâche de l'arbre ; `id` null = versions rattachées directement à l'asset. */
export interface AssetTreeTask {
  id: number | null;
  name: string;
  type: string | null;
  status: string | null;
  department: string | null;
  versions: AssetTreeVersion[];
}

/** La version qui fait foi : étape la plus avancée du pipe, puis la plus récente. */
export interface AssetLatest {
  versionId: number;
  versionName: string;
  department: string | null;
  departmentName: string | null;
  taskId: number | null;
  taskName: string | null;
  createdAt: string;
  media: PipelineMedia | null;
}

/** GET /api/assets/:id/tree */
export interface AssetOverview {
  departments: Department[];
  groups: DepartmentGroup<AssetTreeTask>[];
  latest: AssetLatest | null;
}

// ── Montages automatiques (Phase 45) ─────────────────────────────────────────

/** Un plan du montage. `placeholder` = aucun média publié : la place est tenue par un carton. */
export interface TimelineClip {
  order: number;
  startTime: number;
  duration: number;
  shotId: number;
  shotCode: string;
  shotName: string;
  sequenceId: number | null;
  sequenceCode: string | null;
  versionId: number | null;
  versionName: string | null;
  department: string | null;
  departmentName: string | null;
  mediaId: number | null;
  mediaName: string | null;
  thumbnailUrl: string | null;
  placeholder: boolean;
  durationMismatch: boolean;
}

/** GET /api/timelines — le montage recalculé. `name` null = jamais renommé. */
export interface TimelineView {
  id: number;
  projectId: number;
  sequenceId: number | null;
  sequenceCode: string | null;
  name: string | null;
  department: string | null;
  departments: Department[];
  framerate: number;
  items: TimelineClip[];
  totalDuration: number;
  gapCount: number;
  updatedAt: string;
  latestRevision: number | null;
}

/** Ligne figée d'une révision : libellés recopiés à la prise. */
export interface TimelineSnapshotItem {
  id: number;
  order: number;
  shotId: number | null;
  shotCode: string;
  sequenceCode: string | null;
  versionId: number | null;
  versionName: string | null;
  mediaId: number | null;
  department: string | null;
  duration: number;
}

export interface TimelineSnapshotSummary {
  id: number;
  revision: number;
  note: string | null;
  createdAt: string;
  createdBy: UserRef | null;
  _count: { items: number };
}

/** Écart entre deux révisions : plans ajoutés, retirés, re-versionnés. */
export interface TimelineDiff {
  added: string[];
  removed: string[];
  changed: { shotCode: string; from: string | null; to: string | null }[];
}

/** GET /api/timelines/:id/snapshots/:revision */
export interface TimelineSnapshotDetail {
  snapshot: TimelineSnapshotSummary & { items: TimelineSnapshotItem[] };
  diff: TimelineDiff | null;
  previousRevision: number | null;
}

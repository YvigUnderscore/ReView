// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

// Ordered pipeline, asset space and automatic montages (Phase 45) — separate module from the
// line budget of api.ts. Mirror of the outputs of `PipelineLatestService` and `TimelineService`
// on the backend.
import type { DepartmentSummary, MediaKind, ReviewStatus, UserRef, VersionStatus } from './api';
import type { AssigneeRef } from './entities';

/** Media as the API returns it: signed URL, never a storage key. */
export interface PipelineMedia {
  id: number;
  kind: MediaKind;
  originalName: string;
  mimeType: string;
  createdAt: string;
  thumbnailUrl: string | null;
}

/** Display group ordered by the pipeline; `key` null = catch-all at the end of the list. */
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

/** A task of the tree; `id` null = versions attached directly to the asset. */
export interface AssetTreeTask {
  id: number | null;
  name: string;
  type: string | null;
  status: string | null;
  /** Customisable status (Phase 48) — the one from the ShotGrid site on a linked project. */
  pipelineStatusId?: number | null;
  /** Scheduling (Phase 48) — taken over from ShotGrid when the project is linked to it. */
  startDate?: string | null;
  dueDate?: string | null;
  department: string | null;
  /** Who is responsible for it — shown on the card, and set on right click. */
  assignee: AssigneeRef | null;
  versions: AssetTreeVersion[];
}

/** The authoritative version: most advanced pipeline step, then the most recent. */
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
  departments: DepartmentSummary[];
  groups: DepartmentGroup<AssetTreeTask>[];
  latest: AssetLatest | null;
}

// ── Automatic montages (Phase 45) ────────────────────────────────────────────

/** A shot of the montage. `placeholder` = no published media: the slot is held by a placeholder card. */
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
  /**
   * Kind of the selected media. A shot whose only published version is an image is perfectly
   * legitimate in a montage: the player must hold it on its clock rather than hand it to a
   * `<video>` tag, which cannot demux a JPEG.
   */
  mediaKind: 'VIDEO' | 'IMAGE' | 'MODEL_3D' | 'SPLAT' | null;
  thumbnailUrl: string | null;
  placeholder: boolean;
  durationMismatch: boolean;
}

/** GET /api/timelines — the recomputed montage. `name` null = never renamed. */
export interface TimelineView {
  id: number;
  projectId: number;
  sequenceId: number | null;
  sequenceCode: string | null;
  name: string | null;
  department: string | null;
  departments: DepartmentSummary[];
  framerate: number;
  items: TimelineClip[];
  totalDuration: number;
  gapCount: number;
  updatedAt: string;
  latestRevision: number | null;
}

/** Frozen line of a revision: labels copied at capture time. */
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

/** Difference between two revisions: shots added, removed, re-versioned. */
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

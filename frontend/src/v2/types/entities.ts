// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { AssetType, PipelineOverride, ProjectStatus } from './api';

/**
 * Pipeline entities: project, sequence, shot, asset.
 *
 * Extracted from `api.ts` in C3, when the sequence and asset sheets had grown: the entry module
 * exceeded its line budget. The rule does not change — one entity, one definition, composed with
 * `Pick`/intersection and never redeclared.
 */

/**
 * An assigned person, as the cards receive them.
 *
 * `avatarUrl` is already signed by the server: a grid of two hundred shots carries two hundred
 * copies of the same ten faces, and signing them client-side would have required two hundred round
 * trips for ten distinct objects.
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
 * A person to whom the review of a version is assigned.
 *
 * It is an `AssigneeRef` plus the **brief** written for them: knowing one is expected without
 * knowing what for only saves time for the one doing the assigning. `null` = assigned without a
 * brief, which the project may forbid (`settings.reviewRequest`).
 */
export interface ReviewAssignee extends AssigneeRef {
  note: string | null;
}

/**
 * What a sequence, shot or asset card displays in addition to its name.
 *
 * The three lists share exactly these fields: defining them once is what guarantees that a shot
 * card and an asset card will not diverge from one screen to another — they did until now, for lack
 * of a common type.
 */
export interface EntityCardExtras {
  /** People responsible for the entity itself (distinct from task assignees). */
  assignees?: AssigneeRef[];
  /** Published deliveries that no review decision has settled. */
  awaitingReview?: number;
  /** Last modification (ISO) — "nothing has moved for three weeks". */
  updatedAt?: string;
  /**
   * Has changed since **I** last opened it (lot 9) — or never opened.
   *
   * Computed by the server, and for me alone: two people reading the same list do not see the same
   * lit cards. The server compares the entity's activity, descendants included, with my last visit;
   * the client has nothing to recompute.
   */
  unseen?: boolean;
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
  /** Sequence sheet (C3) — a shot and an asset had one, the sequence did not. */
  description?: string | null;
  thumbnailUrl?: string | null;
  pipelineStatusId?: number | null;
  /** Pipeline override (resolution/fps) inherited from the project — Phase 18/19. */
  settings?: PipelineOverride;
  /**
   * Owning episode (optional per-project level, off by default).
   * `null`/absent = sequence outside any episode — the normal state of a feature film.
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
  /** Shot sheet (C3): an asset had one, a shot did not. */
  description?: string | null;
  pipelineStatusId?: number | null;
  thumbnailUrl?: string | null;
  /** Pipeline override (resolution/fps) inherited sequence → project — Phase 18/19. */
  settings?: PipelineOverride;
  /** Omitted from the montage (Phase 45): skipped by timelines, kept everywhere else. */
  omitted?: boolean;
}
export type ShotRef = Pick<Shot, 'id' | 'code' | 'name'>;
/** GET /api/shots?projectId= */
/** Pipeline step, as the lists return it. */
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
    /** Steps the shot goes through — the department filter relies on it. */
    departments?: DepartmentRef[];
  };

export interface Asset {
  id: number;
  name: string;
  type: AssetType;
  /** Asset status (Phase 48: the site keeps its own list, distinct from tasks). */
  pipelineStatusId?: number | null;
  /** Type label as the studio names it (Phase 48, editable from C3). */
  typeLabel?: string | null;
  description?: string | null;
  thumbnailUrl?: string | null;
}
export type AssetRef = Pick<Asset, 'id' | 'name' | 'type'>;
/**
 * GET /api/assets — the list carries the steps and the assignees, so that a card's context menu
 * knows what to tick without one request per displayed card.
 */
export type AssetListItem = Asset &
  EntityCardExtras & {
    departments?: DepartmentRef[];
    tasks?: {
      id: number;
      departmentId: number | null;
      /** The task's department, named — it may be missing from `departments`. */
      departmentRef?: { id: number; name: string } | null;
      assignee: { id: number; name: string } | null;
    }[];
  };
/** GET /api/assets/:id — N-N links to shots/sequences, plus the sheet (C3). */
export type AssetDetail = Asset & {
  projectId: number;
  shots: (ShotRef & { sequenceId: number | null })[];
  sequences: SequenceRef[];
  departments?: { id: number; key: string; name: string; color?: string | null }[];
};

// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The Episode level — separate module, like `usd.ts` or `share.ts`.
 *
 * **Optional per project**: as long as `EpisodeSettings.enabled` is false — which it is by default —
 * no screen builds or reads these types. A feature-film project never sees any trace of this level.
 *
 * Re-exported from `types/api.ts`: one entity, one definition.
 */

export interface Episode {
  id: number;
  projectId: number;
  code: string;
  name: string;
  order: number;
  description?: string | null;
  thumbnailUrl?: string | null;
  pipelineStatusId?: number | null;
}

export type EpisodeRef = Pick<Episode, 'id' | 'code' | 'name'>;

/** GET /api/episodes?projectId= — one episode in the project list. */
export type EpisodeSummary = Episode & { _count: { sequences: number } };

/** The project switch, and what turning it off would hide. */
export interface EpisodeSettings {
  enabled: boolean;
  episodeCount: number;
  linkedSequenceCount: number;
}

/** Sequence as an episode's sheet renders it. */
export interface EpisodeSequence {
  id: number;
  code: string;
  name: string;
  order: number;
  pipelineStatusId?: number | null;
  thumbnailUrl?: string | null;
  _count: { shots: number };
}

/** Shot as an episode's sheet renders it (all its shots, across all sequences). */
export interface EpisodeShot {
  id: number;
  code: string;
  name: string;
  sequenceId: number | null;
  order: number;
  startFrame?: number | null;
  endFrame?: number | null;
  omitted?: boolean;
  pipelineStatusId?: number | null;
  thumbnailUrl?: string | null;
}

/** GET /api/episodes/:id — the full sheet. */
export type EpisodeDetail = Episode & {
  sequences: EpisodeSequence[];
  shots: EpisodeShot[];
  shotCount: number;
  _count: { sequences: number };
};

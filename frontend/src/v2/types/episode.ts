// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Le niveau Épisode — module séparé, comme `usd.ts` ou `share.ts`.
 *
 * Niveau **facultatif par projet** : tant que `EpisodeSettings.enabled` est faux — ce
 * qu'il est par défaut — aucun écran ne construit ni ne lit ces types. Un projet de
 * long-métrage ne voit jamais la moindre trace de ce niveau.
 *
 * Ré-exporté depuis `types/api.ts` : une entité, une définition.
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

/** GET /api/episodes?projectId= — un épisode dans la liste du projet. */
export type EpisodeSummary = Episode & { _count: { sequences: number } };

/** L'interrupteur du projet, et ce que sa désactivation masquerait. */
export interface EpisodeSettings {
  enabled: boolean;
  episodeCount: number;
  linkedSequenceCount: number;
}

/** Séquence telle que la fiche d'un épisode la rend. */
export interface EpisodeSequence {
  id: number;
  code: string;
  name: string;
  order: number;
  pipelineStatusId?: number | null;
  thumbnailUrl?: string | null;
  _count: { shots: number };
}

/** Plan tel que la fiche d'un épisode le rend (tous ses plans, toutes séquences confondues). */
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

/** GET /api/episodes/:id — la fiche complète. */
export type EpisodeDetail = Episode & {
  sequences: EpisodeSequence[];
  shots: EpisodeShot[];
  shotCount: number;
  _count: { sequences: number };
};

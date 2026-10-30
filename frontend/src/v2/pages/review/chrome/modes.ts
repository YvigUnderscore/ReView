// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  Clapperboard,
  Columns2,
  Compass,
  Eye,
  PencilLine,
  Play,
  Scissors,
  type LucideIcon,
} from 'lucide-react';
import type { MediaKind, Role } from '@/v2/types/api';
import type { MessageKey } from '@/v2/i18n';

/**
 * Mode toggle — the place that decides what exists on screen. Modes are picked with the number
 * keys in every viewer, in toggle order — three in spatial, two on a flat media
 * (`switcherModesFor`, which does not list "Annotate").
 *
 * The first mode (`explore`) is the only one served to clients: `role === 'CLIENT'` does not see
 * the toggle and stays read-only.
 */
export type ModeId = 'explore' | 'annotate' | 'compare' | 'stage' | 'clean';

export interface ReviewMode {
  value: ModeId;
  labelKey: MessageKey;
  icon: LucideIcon;
  /** Sentence shown in the footer: what the mode allows, and for whom. */
  hintKey: MessageKey;
}

/** Flat media (video, image) and spatial media (3D, splat) do not have the same modes. */
export function isSpatialKind(kind: MediaKind): boolean {
  return kind === 'MODEL_3D' || kind === 'SPLAT';
}

const ANNOTATE_SPATIAL: ReviewMode = {
  value: 'annotate',
  labelKey: 'mode.annotate',
  icon: PencilLine,
  hintKey: 'mode.annotateSpatial.hint',
};

const SPATIAL_MODES: ReviewMode[] = [
  {
    value: 'explore',
    labelKey: 'mode.explore',
    icon: Compass,
    hintKey: 'mode.explore.hint',
  },
  ANNOTATE_SPATIAL,
  {
    value: 'stage',
    labelKey: 'mode.stage',
    icon: Clapperboard,
    hintKey: 'mode.stage.hint',
  },
  {
    value: 'clean',
    labelKey: 'mode.clean',
    icon: Scissors,
    hintKey: 'mode.clean.hint',
  },
];

/**
 * Flat media have the same three modes. The image had lost "Fit" in D1 (an eyedropper and a zoom
 * for a helper that promised exposure, gamma and channels); the video lost "Cut" in Phase 50 — the
 * non-destructive cut was only usable before publication, and media are born published since
 * `draftMode` is off by default.
 */
function mediaModes(kind: MediaKind): ReviewMode[] {
  return [
    {
      value: 'explore',
      labelKey: 'mode.watch',
      icon: kind === 'VIDEO' ? Play : Eye,
      hintKey: 'mode.watch.hint',
    },
    {
      value: 'annotate',
      labelKey: 'mode.annotate',
      icon: PencilLine,
      hintKey: 'mode.annotate.hint',
    },
    {
      value: 'compare',
      labelKey: 'mode.compare',
      icon: Columns2,
      hintKey: 'mode.compare.hint',
    },
  ];
}

/** All valid modes of a media type — including "Annotate", which is not listed in the toggle. */
export function modesFor(kind: MediaKind): ReviewMode[] {
  return isSpatialKind(kind) ? SPATIAL_MODES : mediaModes(kind);
}

/**
 * Modes actually reachable. "Compare" requires a neighbouring version: without one, the mode armed
 * on nothing — the comparison selector disappeared at the same time, and one was stuck in a mode
 * that showed no comparison. `canCompare` comes from the hook that lists the neighbours
 * (`useCompareTargets`), the sole judge of the question.
 */
export function allowedModesFor(kind: MediaKind, canCompare = true): ReviewMode[] {
  return modesFor(kind).filter((m) => canCompare || m.value !== 'compare');
}

/**
 * Modes offered by the header toggle and the number keys. "Annotate" is no longer listed there:
 * annotation is armed from the comment space (composer button, right-click) or through the
 * shortcut of a drawing tool — the mode stays valid, simply not listed.
 */
export function switcherModesFor(kind: MediaKind, canCompare = true): ReviewMode[] {
  return allowedModesFor(kind, canCompare).filter((m) => m.value !== 'annotate');
}

/** Default mode — the one served to clients. */
export const DEFAULT_MODE: ModeId = 'explore';

/**
 * Is the mode toggle offered? The client stays in exploration, read-only; and a single segment
 * switches to nothing — the edit mount, which only has one mode, does without it.
 */
export function canSwitchMode(role: Role, modeCount: number): boolean {
  return role !== 'CLIENT' && modeCount > 1;
}

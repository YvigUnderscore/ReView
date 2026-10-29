// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Hand } from 'lucide-react';
import { modesFor, type ModeId, type ReviewMode } from '../review/chrome/modes';
import { DRAW_TOOLS, type ReviewTool } from '../review/chrome/tools';

/**
 * What the review shell offers on a montage (Phase 46).
 *
 * The montage has only one mode: watching it. A/B comparison and trimming apply to a media, not to
 * an assembled film — offering them here would promise gestures that do not exist. Annotation, for
 * its part, is armed from the composer, as everywhere else.
 */
export const MONTAGE_MODES: ReviewMode[] = modesFor('VIDEO').filter((m) => m.value === 'explore');

/**
 * Idle tool of the montage. The review's one promises a pan and a zoom on the image; here a click
 * plays or pauses, and nothing else — the tooltip must say so.
 */
const MONTAGE_NAV: ReviewTool = {
  id: 'nav',
  labelKey: 'tool.nav',
  icon: Hand,
  key: 'V',
  hintKey: 'timeline.navHint',
};

/** Montage rail: navigation, plus the drawing tools as soon as annotation is armed. */
export function montageTools(annotating: boolean): ReviewTool[] {
  return annotating ? [MONTAGE_NAV, ...DRAW_TOOLS] : [MONTAGE_NAV];
}

/**
 * The same rail, seen per mode — this is what the keyboard must follow. Defined at module level to
 * keep a stable identity: the chrome hook subscribes to it.
 */
export const montageToolsFor = (mode: ModeId): ReviewTool[] => montageTools(mode === 'annotate');

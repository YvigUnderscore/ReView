// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Shape } from '../../components/AnnotationCanvas';
import type { StagedReference } from './referenceBox';

/**
 * History of the annotation in progress. A single undo step covers **the drawing and the
 * pasted references**: both go with the same comment, and undoing them separately would make
 * no sense to someone who just pressed Ctrl+Z.
 */
export interface AnnotationSnapshot {
  shapes: Shape[];
  refs: StagedReference[];
}

export interface AnnotationHistory {
  past: AnnotationSnapshot[];
  future: AnnotationSnapshot[];
}

export const EMPTY_HISTORY: AnnotationHistory = { past: [], future: [] };

/** Opens a step: the current state moves to the past, the future becomes unreachable. */
export const pushStep = (h: AnnotationHistory, current: AnnotationSnapshot): AnnotationHistory => ({
  past: [...h.past, current],
  future: [],
});

export interface HistoryMove {
  history: AnnotationHistory;
  snapshot: AnnotationSnapshot;
}

export function undoStep(h: AnnotationHistory, current: AnnotationSnapshot): HistoryMove | null {
  const snapshot = h.past[h.past.length - 1];
  if (!snapshot) return null;
  return { history: { past: h.past.slice(0, -1), future: [current, ...h.future] }, snapshot };
}

export function redoStep(h: AnnotationHistory, current: AnnotationSnapshot): HistoryMove | null {
  const snapshot = h.future[0];
  if (!snapshot) return null;
  return { history: { past: [...h.past, current], future: h.future.slice(1) }, snapshot };
}

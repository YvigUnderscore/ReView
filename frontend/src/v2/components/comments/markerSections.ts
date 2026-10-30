// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReviewComment, TimelineMarker } from '../../types/api';

/**
 * Splits the comment thread by timeline markers (feedback round 34): each marker becomes a
 * separator, and timestamped comments are filed in the section of the last marker preceding them
 * (marker frame <= comment frame).
 */
export interface MarkerSection {
  /** null = head section (before the first marker, plus comments without a timecode). */
  marker: TimelineMarker | null;
  comments: ReviewComment[];
}

export function markerSections(
  comments: ReviewComment[],
  markers: TimelineMarker[],
  fps: number,
): MarkerSection[] {
  if (markers.length === 0) return [{ marker: null, comments }];
  const sorted = [...markers].sort((a, b) => a.frame - b.frame);
  const sections: MarkerSection[] = [
    { marker: null, comments: [] },
    ...sorted.map((m) => ({ marker: m, comments: [] as ReviewComment[] })),
  ];
  for (const c of comments) {
    // Without a timecode: a general comment goes to the head section, before the "chapters".
    const frame = c.timestamp != null ? Math.round(c.timestamp * (fps || 24)) : null;
    let idx = 0;
    if (frame != null) for (let i = 0; i < sorted.length; i++) if (frame >= sorted[i].frame) idx = i + 1;
    sections[idx].comments.push(c);
  }
  return sections;
}

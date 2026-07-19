import type { ReviewComment, TimelineMarker } from '../../types/api';

/**
 * Découpage du fil de commentaires par les marqueurs de timeline (retours 34) : chaque
 * marqueur devient un séparateur, les commentaires horodatés sont rangés dans la section
 * du dernier marqueur qui les précède (frame du marqueur ≤ frame du commentaire).
 */
export interface MarkerSection {
  /** null = section de tête (avant le premier marqueur + commentaires sans timecode). */
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
    // Sans timecode : commentaire général → section de tête, avant les « chapitres ».
    const frame = c.timestamp != null ? Math.round(c.timestamp * (fps || 24)) : null;
    let idx = 0;
    if (frame != null) for (let i = 0; i < sorted.length; i++) if (frame >= sorted[i]!.frame) idx = i + 1;
    sections[idx]!.comments.push(c);
  }
  return sections;
}

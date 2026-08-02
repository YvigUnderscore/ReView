// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import type { ReviewComment, TimelineMarker } from '../../types/api';
import { markerSections } from './markerSections';

const comment = (id: number, timestamp: number | null) =>
  ({ id, timestamp, content: `c${id}` }) as ReviewComment;
const marker = (id: number, frame: number) =>
  ({ id, frame, name: `m${id}`, color: '#22d3ee' }) as TimelineMarker;

describe('markerSections — séparateurs marqueurs du fil (retours 34)', () => {
  it('sans marqueur : une seule section, ordre inchangé', () => {
    const comments = [comment(1, 0.5), comment(2, null)];
    expect(markerSections(comments, [], 24)).toEqual([{ marker: null, comments }]);
  });

  it('range chaque commentaire dans la section du dernier marqueur qui le précède', () => {
    // fps 24 : frames 12, 48, 120 ; marqueurs aux frames 24 et 96.
    const c1 = comment(1, 0.5); // frame 12 → tête
    const c2 = comment(2, 2); // frame 48 → après m1 (24)
    const c3 = comment(3, 5); // frame 120 → après m2 (96)
    const sections = markerSections([c1, c2, c3], [marker(1, 24), marker(2, 96)], 24);
    expect(sections.map((s) => s.comments)).toEqual([[c1], [c2], [c3]]);
    expect(sections.map((s) => s.marker?.id ?? null)).toEqual([null, 1, 2]);
  });

  it('un commentaire pile sur la frame du marqueur appartient à sa section', () => {
    const c = comment(1, 1); // frame 24
    const sections = markerSections([c], [marker(1, 24)], 24);
    expect(sections[1]!.comments).toEqual([c]);
  });

  it('les commentaires sans timecode vont en tête ; les marqueurs sont triés par frame', () => {
    const general = comment(1, null);
    const late = comment(2, 10); // frame 240
    const sections = markerSections([late, general], [marker(2, 200), marker(1, 50)], 24);
    expect(sections[0]!.comments).toEqual([general]);
    expect(sections.map((s) => s.marker?.id ?? null)).toEqual([null, 1, 2]);
    expect(sections[2]!.comments).toEqual([late]);
  });

  it('les sections vides restent listées (le marqueur sert de repère cliquable)', () => {
    const sections = markerSections([], [marker(1, 24)], 24);
    expect(sections).toHaveLength(2);
    expect(sections[1]!.comments).toEqual([]);
  });
});

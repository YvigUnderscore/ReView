// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { toOtio } from './notesOtio';

/**
 * OTIO est un JSON typé par des noms de schéma : c'est cela qu'un lecteur vérifie avant
 * tout le reste. On confronte donc la structure produite au document que
 * `otio.adapters.write_to_string` écrirait pour la même timeline.
 */

interface OtioTime {
  OTIO_SCHEMA: string;
  rate: number;
  value: number;
}
interface OtioRange {
  OTIO_SCHEMA: string;
  start_time: OtioTime;
  duration: OtioTime;
}
interface OtioMarkerOut {
  OTIO_SCHEMA: string;
  name: string;
  color: string;
  marked_range: OtioRange;
  metadata: { ReView?: { noteId?: number } };
}
interface OtioClipOut {
  OTIO_SCHEMA: string;
  name: string;
  source_range: OtioRange;
  markers: OtioMarkerOut[];
  media_reference: { OTIO_SCHEMA: string; target_url?: string };
}
interface OtioDoc {
  OTIO_SCHEMA: string;
  name: string;
  global_start_time: OtioTime;
  tracks: {
    OTIO_SCHEMA: string;
    children: Array<{ OTIO_SCHEMA: string; kind: string; children: OtioClipOut[] }>;
  };
}

const parse = (text: string): OtioDoc => JSON.parse(text) as OtioDoc;

const document = parse(
  toOtio({
    name: 'Dailies 21/08',
    fps: 25,
    clips: [
      {
        name: 'SH010_comp_v003',
        duration: 4,
        url: 'https://minio/SH010.mp4',
        markers: [
          { at: 2, span: 0.4, color: 'RED', name: 'Alice: flicker', metadata: { noteId: 12 } },
          { at: 50, color: 'GREEN', name: 'Bob: ok' },
        ],
      },
      { name: 'SH020_comp_v001', duration: 2, markers: [] },
      { name: 'vide', duration: 0, markers: [] },
    ],
  }),
);

const track = document.tracks.children[0]!;
const clip = track.children[0]!;

describe('toOtio', () => {
  it('produit une timeline avec une seule piste vidéo', () => {
    expect(document.OTIO_SCHEMA).toBe('Timeline.1');
    expect(document.name).toBe('Dailies 21/08');
    expect(document.tracks.OTIO_SCHEMA).toBe('Stack.1');
    expect(track.OTIO_SCHEMA).toBe('Track.1');
    expect(track.kind).toBe('Video');
  });

  it('exprime les durées en frames à la cadence donnée', () => {
    expect(document.global_start_time).toEqual({ OTIO_SCHEMA: 'RationalTime.1', rate: 25, value: 0 });
    expect(clip.source_range.duration.value).toBe(100);
    expect(clip.source_range.start_time.value).toBe(0);
  });

  it('écarte les clips de durée nulle', () => {
    expect(track.children).toHaveLength(2);
    expect(track.children.map((c) => c.name)).not.toContain('vide');
  });

  it('pose les notes en marqueurs du clip, plage comprise', () => {
    const [first, second] = clip.markers;
    expect(first?.OTIO_SCHEMA).toBe('Marker.2');
    expect(first?.color).toBe('RED');
    expect(first?.name).toBe('Alice: flicker');
    expect(first?.marked_range.start_time.value).toBe(50);
    expect(first?.marked_range.duration.value).toBe(10);
    expect(first?.metadata.ReView?.noteId).toBe(12);
    // Un marqueur hors du clip revient sur sa dernière frame plutôt que de disparaître.
    expect(second?.marked_range.start_time.value).toBe(99);
    expect(second?.marked_range.duration.value).toBe(0);
  });

  it('déclare une référence externe quand l’URL existe, manquante sinon', () => {
    expect(clip.media_reference.OTIO_SCHEMA).toBe('ExternalReference.1');
    expect(clip.media_reference.target_url).toBe('https://minio/SH010.mp4');
    expect(track.children[1]?.media_reference.OTIO_SCHEMA).toBe('MissingReference.1');
  });
});

// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * OpenTimelineIO (JSON) d'une playlist ou d'un montage, notes de review en marqueurs.
 *
 * Écrit à la main plutôt qu'avec la bibliothèque Python : le sous-ensemble dont ReView a
 * besoin — une timeline, une piste vidéo, des clips bout à bout, des marqueurs — tient en
 * quelques schémas stables, et une dépendance de plus se paierait à chaque déploiement.
 *
 * Le parti est celui d'un OTIO **minimal mais valide** : uniquement des schémas que toutes
 * les versions d'OTIO depuis 0.14 savent relire (`Timeline.1`, `Stack.1`, `Track.1`,
 * `Clip.1`, `Marker.2`, `ExternalReference.1`, `MissingReference.1`, `RationalTime.1`,
 * `TimeRange.1`). En particulier `Clip.1`/`media_reference` plutôt que `Clip.2`/
 * `media_references` : le lecteur récent fait la montée de version tout seul, l'inverse
 * n'est pas vrai.
 *
 * Sérialisation PURE (aucune dépendance) : le service fournit clips et marqueurs résolus.
 */

/** Couleurs de marqueur définies par OTIO (`otio.schema.MarkerColor`). */
export type OtioColor = 'RED' | 'GREEN' | 'BLUE' | 'CYAN' | 'YELLOW' | 'MAGENTA' | 'WHITE';

export interface OtioMarker {
  name: string;
  color: OtioColor;
  /** Position dans le clip, en secondes depuis son début. */
  at: number;
  /** Durée de la plage commentée, en secondes (0 = marqueur ponctuel). */
  span?: number;
  /** Métadonnées ReView reportées telles quelles (id de note, état, auteur…). */
  metadata?: Record<string, unknown>;
}

export interface OtioClip {
  name: string;
  /** Durée du clip en secondes. */
  duration: number;
  /** URL du média, si on en publie une ; sinon la référence est déclarée manquante. */
  url?: string | null;
  markers: OtioMarker[];
  metadata?: Record<string, unknown>;
}

export interface OtioInput {
  name: string;
  fps: number;
  clips: OtioClip[];
}

const rationalTime = (frames: number, rate: number) => ({
  OTIO_SCHEMA: 'RationalTime.1',
  rate,
  value: frames,
});

const timeRange = (startFrames: number, durationFrames: number, rate: number) => ({
  OTIO_SCHEMA: 'TimeRange.1',
  start_time: rationalTime(startFrames, rate),
  duration: rationalTime(durationFrames, rate),
});

/** Frames arrondies d'un instant — même convention que l'EDL. */
const framesAt = (seconds: number, fps: number): number =>
  !Number.isFinite(seconds) || fps <= 0 ? 0 : Math.max(0, Math.round(seconds * fps));

function mediaReference(url: string | null | undefined) {
  if (!url) return { OTIO_SCHEMA: 'MissingReference.1', name: '', available_range: null, metadata: {} };
  return {
    OTIO_SCHEMA: 'ExternalReference.1',
    name: '',
    available_range: null,
    metadata: {},
    target_url: url,
  };
}

function marker(m: OtioMarker, fps: number, clipFrames: number) {
  const start = Math.min(framesAt(m.at, fps), Math.max(0, clipFrames - 1));
  const duration = Math.min(framesAt(m.span ?? 0, fps), Math.max(0, clipFrames - start));
  return {
    OTIO_SCHEMA: 'Marker.2',
    name: m.name,
    color: m.color,
    comment: '',
    marked_range: timeRange(start, duration, fps),
    metadata: m.metadata ? { ReView: m.metadata } : {},
  };
}

function clip(c: OtioClip, fps: number) {
  const frames = framesAt(c.duration, fps);
  return {
    OTIO_SCHEMA: 'Clip.1',
    name: c.name,
    source_range: timeRange(0, frames, fps),
    effects: [],
    markers: c.markers.map((m) => marker(m, fps, frames)),
    enabled: true,
    media_reference: mediaReference(c.url),
    metadata: c.metadata ? { ReView: c.metadata } : {},
  };
}

/**
 * Sérialise une suite de clips en document OTIO (JSON indenté, comme l'écrit
 * `otio.adapters.write_to_string`). Les clips de durée nulle sont écartés : OTIO les
 * accepte, mais aucun logiciel de montage n'en fait quoi que ce soit.
 */
export function toOtio(input: OtioInput): string {
  const fps = input.fps > 0 ? input.fps : 24;
  const children = input.clips.filter((c) => framesAt(c.duration, fps) > 0).map((c) => clip(c, fps));
  const document = {
    OTIO_SCHEMA: 'Timeline.1',
    name: input.name,
    global_start_time: rationalTime(0, fps),
    metadata: { ReView: { generator: 'ReView' } },
    tracks: {
      OTIO_SCHEMA: 'Stack.1',
      name: 'tracks',
      source_range: null,
      effects: [],
      markers: [],
      enabled: true,
      metadata: {},
      children: [
        {
          OTIO_SCHEMA: 'Track.1',
          name: 'V1',
          kind: 'Video',
          source_range: null,
          effects: [],
          markers: [],
          enabled: true,
          metadata: {},
          children,
        },
      ],
    },
  };
  return `${JSON.stringify(document, null, 2)}\n`;
}

// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * EDL CMX3600 d'une playlist ou d'un montage, notes de review incluses en marqueurs.
 *
 * C'est le format que toute salle de montage sait lire (Resolve, Premiere, Avid, Hiero).
 * Un événement par clip, bout à bout sur la timeline d'enregistrement ; chaque note
 * devient une ligne `* LOC:` — la convention Resolve/Premiere pour un marqueur — placée au
 * timecode d'enregistrement où elle a été écrite.
 *
 * Volontairement conservateur : reel `AX` (auxiliaire) et nom réel en `* FROM CLIP NAME:`,
 * parce que la colonne reel du CMX3600 tient sur huit caractères et qu'un nom de média
 * de studio n'y entre jamais. Non-drop uniquement : ReView ne stocke pas de timecode
 * source, tout part de 00:00:00:00 — mieux vaut un EDL cohérent qu'un EDL qui prétend
 * connaître le timecode plateau.
 *
 * Sérialisation PURE (aucune dépendance) : le service fournit clips et marqueurs résolus.
 */

/** Couleurs de marqueur acceptées par les EDL de Resolve/Premiere. */
export type EdlColor = 'RED' | 'GREEN' | 'BLUE' | 'CYAN' | 'YELLOW' | 'WHITE';

export interface EdlMarker {
  /** Position dans le clip, en secondes depuis son début. */
  at: number;
  color: EdlColor;
  /** Libellé du marqueur (auteur + texte) — replié sur une ligne. */
  label: string;
}

export interface EdlClip {
  /** Nom lisible du média (`* FROM CLIP NAME:`). */
  name: string;
  /** Durée du clip en secondes. */
  duration: number;
  markers: EdlMarker[];
}

export interface EdlInput {
  title: string;
  fps: number;
  clips: EdlClip[];
}

/** Longueur maximale d'un libellé de marqueur : au-delà, les lecteurs tronquent eux-mêmes. */
const MAX_LABEL = 180;

/** Index de frame d'un instant, cadence donnée. */
export function framesAt(seconds: number, fps: number): number {
  if (!Number.isFinite(seconds) || !Number.isFinite(fps) || fps <= 0) return 0;
  return Math.max(0, Math.round(seconds * fps));
}

/** Timecode non-drop HH:MM:SS:FF d'un index de frame. */
export function timecodeFromFrames(frame: number, fps: number): string {
  const perSecond = Math.max(1, Math.round(fps));
  const f = Math.max(0, Math.round(frame));
  const totalSeconds = Math.floor(f / perSecond);
  const p = (n: number) => String(n).padStart(2, '0');
  const hh = p(Math.floor(totalSeconds / 3600) % 24);
  const mm = p(Math.floor(totalSeconds / 60) % 60);
  return `${hh}:${mm}:${p(totalSeconds % 60)}:${p(f % perSecond)}`;
}

/** Timecode non-drop d'un instant en secondes. */
export const timecodeAt = (seconds: number, fps: number): string =>
  timecodeFromFrames(framesAt(seconds, fps), fps);

/** Une ligne d'EDL ne supporte ni saut de ligne ni tabulation. */
function oneLine(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > MAX_LABEL ? `${flat.slice(0, MAX_LABEL - 1)}…` : flat;
}

/** Un événement CMX3600 : numéro, reel, piste, coupe franche, quatre timecodes. */
function eventLine(index: number, srcIn: string, srcOut: string, recIn: string, recOut: string): string {
  const num = String(index).padStart(3, '0');
  return `${num}  ${'AX'.padEnd(8)} ${'V'.padEnd(5)} ${'C'.padEnd(8)}${srcIn} ${srcOut} ${recIn} ${recOut}`;
}

/**
 * Sérialise une suite de clips en EDL. Les clips de durée nulle ou négative sont ignorés :
 * un événement de longueur zéro fait échouer l'import chez la plupart des lecteurs.
 */
export function toEdl(input: EdlInput): string {
  const fps = input.fps > 0 ? input.fps : 24;
  const lines = [`TITLE: ${oneLine(input.title)}`, 'FCM: NON-DROP FRAME', ''];
  let recordFrame = 0;
  let event = 0;
  for (const clip of input.clips) {
    const length = framesAt(clip.duration, fps);
    if (length <= 0) continue;
    event += 1;
    const srcIn = timecodeFromFrames(0, fps);
    const srcOut = timecodeFromFrames(length, fps);
    const recIn = timecodeFromFrames(recordFrame, fps);
    const recOut = timecodeFromFrames(recordFrame + length, fps);
    lines.push(eventLine(event, srcIn, srcOut, recIn, recOut));
    lines.push(`* FROM CLIP NAME: ${oneLine(clip.name)}`);
    for (const marker of clip.markers) {
      // Un marqueur posé au-delà de la fin du clip est ramené sur sa dernière frame :
      // hors de l'événement, les lecteurs le rattachent au clip suivant.
      const offset = Math.min(framesAt(marker.at, fps), Math.max(0, length - 1));
      const at = timecodeFromFrames(recordFrame + offset, fps);
      lines.push(`* LOC: ${at} ${marker.color} ${oneLine(marker.label)}`);
    }
    lines.push('');
    recordFrame += length;
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

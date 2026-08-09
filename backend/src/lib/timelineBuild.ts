// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Construction d'un montage — analyse PURE, testée (Phase 45).
 *
 * Un montage automatique est une suite de plans dans l'ordre de la production, chacun
 * représenté par sa version la plus avancée. Deux principes gouvernent ce fichier :
 *
 *  - un plan sans média n'est pas sauté, il est remplacé par un carton à sa durée. Un
 *    montage qui masque ses trous ment sur sa durée et cache précisément ce qu'un
 *    superviseur cherche à voir ;
 *  - la durée affichée est celle du média réel. Quand elle diverge de la plage de frames
 *    déclarée sur le plan, l'écart est SIGNALÉ, jamais corrigé en silence : recadrer sans
 *    le dire transformerait un problème visible en surprise au montage final.
 */

/** Durée d'un carton, faute de plage de frames sur le plan (secondes). */
export const PLACEHOLDER_DURATION = 4;

/** Écart toléré entre durée du média et durée déclarée avant signalement (secondes). */
const DURATION_TOLERANCE = 0.5;

export interface ShotRow {
  id: number;
  code: string;
  name: string;
  sequenceId: number | null;
  sequenceCode: string | null;
  startFrame: number | null;
  endFrame: number | null;
}

export interface PickRow {
  versionId: number;
  versionName: string;
  department: string | null;
  mediaId: number | null;
  mediaDuration: number | null;
}

export interface TimelineItem {
  order: number;
  startTime: number;
  duration: number;
  shotId: number;
  shotCode: string;
  shotName: string;
  sequenceId: number | null;
  sequenceCode: string | null;
  versionId: number | null;
  versionName: string | null;
  department: string | null;
  mediaId: number | null;
  /** Aucun média publié : la place est tenue par un carton. */
  placeholder: boolean;
  /** La durée du média s'écarte de la plage de frames déclarée sur le plan. */
  durationMismatch: boolean;
}

/** Durée déclarée d'un plan d'après ses frames, ou null si la plage est absente/absurde. */
export function declaredDuration(shot: ShotRow, fps: number): number | null {
  if (shot.startFrame === null || shot.endFrame === null || fps <= 0) return null;
  const frames = shot.endFrame - shot.startFrame + 1;
  return frames > 0 ? frames / fps : null;
}

/**
 * Durée d'un clip. Le média fait foi ; à défaut la plage de frames du plan ; à défaut une
 * durée de carton, pour qu'un plan sans rien occupe quand même une place visible.
 */
export function clipDuration(mediaDuration: number | null, declared: number | null): number {
  if (mediaDuration !== null && mediaDuration > 0) return mediaDuration;
  if (declared !== null && declared > 0) return declared;
  return PLACEHOLDER_DURATION;
}

/** Assemble les plans et les versions élues en une suite de clips horodatée. */
export function buildItems(shots: ShotRow[], picks: Map<number, PickRow>, fps: number): TimelineItem[] {
  const items: TimelineItem[] = [];
  let cursor = 0;
  shots.forEach((shot, index) => {
    const pick = picks.get(shot.id) ?? null;
    const declared = declaredDuration(shot, fps);
    const duration = clipDuration(pick?.mediaDuration ?? null, declared);
    const mediaDuration = pick?.mediaDuration ?? null;
    items.push({
      order: index,
      startTime: Math.round(cursor * 1000) / 1000,
      duration: Math.round(duration * 1000) / 1000,
      shotId: shot.id,
      shotCode: shot.code,
      shotName: shot.name,
      sequenceId: shot.sequenceId,
      sequenceCode: shot.sequenceCode,
      versionId: pick?.versionId ?? null,
      versionName: pick?.versionName ?? null,
      department: pick?.department ?? null,
      mediaId: pick?.mediaId ?? null,
      placeholder: !pick || pick.mediaId === null,
      durationMismatch:
        mediaDuration !== null &&
        declared !== null &&
        Math.abs(mediaDuration - declared) > DURATION_TOLERANCE,
    });
    cursor += duration;
  });
  return items;
}

/** Total d'un montage (secondes), arrondi à la milliseconde. */
export function totalDuration(items: TimelineItem[]): number {
  return Math.round(items.reduce((sum, it) => sum + it.duration, 0) * 1000) / 1000;
}

export interface DiffEntry {
  shotCode: string;
  from: string | null;
  to: string | null;
}

/** Ce qui a changé d'une révision à l'autre — la question que pose tout superviseur. */
export interface TimelineDiff {
  added: string[];
  removed: string[];
  changed: DiffEntry[];
}

/**
 * Compare deux états d'un montage par code de plan. Le code est la seule identité stable :
 * un plan peut être recréé (nouvel identifiant) sans que le montage ait changé pour autant.
 */
export function diffItems(
  previous: readonly { shotCode: string; versionName: string | null }[],
  current: readonly { shotCode: string; versionName: string | null }[],
): TimelineDiff {
  const before = new Map(previous.map((it) => [it.shotCode, it.versionName]));
  const after = new Map(current.map((it) => [it.shotCode, it.versionName]));
  const added: string[] = [];
  const removed: string[] = [];
  const changed: DiffEntry[] = [];

  for (const [code, version] of after) {
    if (!before.has(code)) {
      added.push(code);
      continue;
    }
    const from = before.get(code) ?? null;
    if (from !== version) changed.push({ shotCode: code, from, to: version ?? null });
  }
  for (const code of before.keys()) if (!after.has(code)) removed.push(code);

  return { added, removed, changed };
}

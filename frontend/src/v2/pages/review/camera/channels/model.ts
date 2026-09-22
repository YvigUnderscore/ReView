// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SplatCamera, SplatCameraKeyframe } from '../../reviewTypes';

/**
 * Modèle d'animation caméra « par canaux » (Phase 17, v2) — façon logiciel 3D. Chaque grandeur
 * animable est un canal (F-curve) : une liste de clés `{ t, v, tangentes, mode }`, éditables
 * individuellement (déplacer dans le temps/valeur, tangentes). Remplace le format v1
 * (`keyframes[{ t, pose, easing }]`). Purement données — l'échantillonnage vit dans `hermite.ts`,
 * l'état/édition dans `useCameraAnim`, le rendu dans `timeline/`.
 */

/** Canaux animables : position (x/y/z), cible (x/y/z), focale, tilt. */
export type ChannelId = 'px' | 'py' | 'pz' | 'tx' | 'ty' | 'tz' | 'fov' | 'roll';
export const CHANNEL_IDS: readonly ChannelId[] = ['px', 'py', 'pz', 'tx', 'ty', 'tz', 'fov', 'roll'];

/**
 * Mode de tangente **unifié** d'une clé (forme d'origine de la v2) : lissée auto, linéaire, palier,
 * ou libre (poignées). Reste écrit dans chaque clé même quand les deux côtés divergent — c'est le
 * résumé que lisent les lecteurs antérieurs aux côtés séparés (schémas Zod du serveur, animations
 * jointes aux commentaires déjà en base). Voir `tangents.ts` pour l'invariant.
 */
export type TangentMode = 'auto' | 'linear' | 'step' | 'free';

/**
 * Type de tangente d'**un côté** d'une clé (façon Maya) : `auto` (lissée), `linear`, `flat` (pente
 * nulle), `step` (palier — côté sortant seulement) et `free` (poignée éditée). Absent d'une clé, le
 * côté retombe sur `mode` : les animations enregistrées avant les côtés séparés se relisent à
 * l'identique, sans réécriture des données.
 */
export type TangentType = 'auto' | 'linear' | 'flat' | 'step' | 'free';

/**
 * Extrapolation d'un canal **hors** de ses clés (pré/post-infinity, façon Maya). `constant`
 * (défaut, et comportement d'origine) maintient la valeur de la clé extrême ; `cycle` rejoue la
 * courbe, `cycleOffset` en cumulant l'écart, `linear` prolonge la pente, `oscillate` va-et-vient.
 */
export type Extrapolation = 'constant' | 'cycle' | 'cycleOffset' | 'linear' | 'oscillate';

/** Clé d'un canal : temps (ms), valeur, tangentes entrante/sortante (pente, unités/ms) si `free`. */
export interface CurveKey {
  t: number;
  v: number;
  tin?: number;
  tout?: number;
  mode: TangentMode;
  /** Type du côté entrant (absent = `mode`). */
  modeIn?: TangentType;
  /** Type du côté sortant (absent = `mode`). */
  modeOut?: TangentType;
  /** Poignées désolidarisées : tirer un côté ne fait plus tourner l'autre (absent = unifiées). */
  broken?: boolean;
  /** Pondération du côté entrant (longueur de poignée, 1 = Hermite non pondéré ; absent = 1). */
  wIn?: number;
  /** Pondération du côté sortant (absent = 1). */
  wOut?: number;
}

export interface Channel {
  keys: CurveKey[];
  /** Extrapolation avant la première clé (absent = `constant`). */
  pre?: Extrapolation;
  /** Extrapolation après la dernière clé (absent = `constant`). */
  post?: Extrapolation;
}

/**
 * Pose de repli **persistée avec l'animation** (Phase 50, lot 13) : exactement les grandeurs qu'un
 * canal **sans clé** lit à l'échantillonnage (`hermite.sampleAnimV2`).
 *
 * Elle existe parce que ce repli était *dynamique* — la vue de celui qui regarde — et que deux
 * échantillonneurs le prenaient à deux endroits : le lecteur keyframe sur une pose capturée
 * seulement dans certains parcours (`setAnim`, première clé posée à la vue), l'origine du monde
 * sinon ; le rig de scène sur la vue d'activation du mode layout. Une animation construite AU
 * GIZMO, qui ne clé que la position, voyait donc sa cible sauter à l'origine dès le premier scrub.
 * La base voyage désormais avec l'animation : mêmes canaux non clés, même pose, en lecture comme
 * hors lecture, pour tout spectateur, et à l'export glTF.
 */
export interface CameraAnimBase {
  position: { x: number; y: number; z: number };
  target: { x: number; y: number; z: number };
  fov?: number;
  roll?: number;
}

/** Animation caméra v2 : canaux indépendants + boucle. La durée = plus grand temps de clé. */
export interface CameraAnimV2 {
  version: 2;
  loop: boolean;
  channels: Partial<Record<ChannelId, Channel>>;
  /** Durée de lecture réglable (ms) — override du plus grand temps de clé (Phase 27). Guide dans
   *  le graph ; la lecture en boucle va de 0 à cette durée. Édition de clés au-delà autorisée. */
  durationMs?: number;
  /**
   * Pose de repli des canaux sans clé (Phase 50, lot 13). **Facultative** : une animation
   * enregistrée avant elle n'en porte pas et garde le repli dynamique d'alors — son rejeu ne
   * change pas d'un caractère (migration à la lecture, comme `fromV1`). Une animation neuve
   * l'adopte (`seedAnimBase`) et devient, elle, déterministe.
   */
  base?: CameraAnimBase;
}

export const emptyAnim = (loop = true): CameraAnimV2 => ({ version: 2, loop, channels: {} });

/** Décompose une pose caméra en valeurs par canal (les canaux absents retombent sur la pose de base). */
export function poseToChannelValues(pose: SplatCamera): Record<ChannelId, number | undefined> {
  return {
    px: pose.position.x,
    py: pose.position.y,
    pz: pose.position.z,
    tx: pose.target.x,
    ty: pose.target.y,
    tz: pose.target.z,
    fov: pose.fov,
    roll: pose.roll,
  };
}

/**
 * Projette une pose caméra sur la forme minimale d'une base : les seules valeurs que
 * l'échantillonnage lit en repli. L'aspect et la profondeur de champ n'en font pas partie — ils
 * ne sont pas animables, et la base n'est pas une deuxième présentation.
 */
export function poseToBase(pose: SplatCamera): CameraAnimBase {
  const base: CameraAnimBase = {
    position: { x: pose.position.x, y: pose.position.y, z: pose.position.z },
    target: { x: pose.target.x, y: pose.target.y, z: pose.target.z },
  };
  if (pose.fov != null) base.fov = pose.fov;
  if (pose.roll != null) base.roll = pose.roll;
  return base;
}

/**
 * Base effective d'une animation : la sienne si elle en porte une, sinon `fallback` (le repli
 * dynamique d'avant). **Seul arbitre du dépôt** — les deux échantillonneurs passent par
 * `sampleAnimV2`, qui passe par ici : ils ne peuvent plus lire deux bases différentes.
 */
export function animBase(anim: CameraAnimV2, fallback: CameraAnimBase): CameraAnimBase {
  return anim.base ?? fallback;
}

/**
 * Valeurs par canal de la base — ce que `sampleAnimV2` lit quand un canal n'a aucune clé. Poser
 * une clé sur un canal vide doit écrire CETTE valeur : à défaut, la courbe part de zéro, c'est-
 * à-dire une focale de 0° ou un axe collé à l'origine. Les valeurs de repli de `fov`/`roll` sont
 * celles de l'échantillonnage.
 */
export function baseChannelValues(base: CameraAnimBase): Record<ChannelId, number> {
  return {
    px: base.position.x,
    py: base.position.y,
    pz: base.position.z,
    tx: base.target.x,
    ty: base.target.y,
    tz: base.target.z,
    fov: base.fov ?? 60,
    roll: base.roll ?? 0,
  };
}

/**
 * Adopte `view` comme base de l'animation — **seulement si elle est neuve** : aucune base, aucune
 * clé. Une animation qui porte déjà des clés sans base est héritée ; lui en donner une changerait
 * son rejeu (présentations persistées, animations jointes à des commentaires déjà en base), ce qui
 * est exclu. Idempotent, donc appelable à chaque écriture de clé. Pur/testable.
 */
export function seedAnimBase(anim: CameraAnimV2, view: SplatCamera | undefined): CameraAnimV2 {
  if (!view || anim.base || animKeyTimes(anim).length > 0) return anim;
  return { ...anim, base: poseToBase(view) };
}

/** Temps (ms) triés et dédupliqués de toutes les clés, tous canaux confondus (colonnes dopesheet). */
export function animKeyTimes(anim: CameraAnimV2): number[] {
  const set = new Set<number>();
  for (const id of CHANNEL_IDS) anim.channels[id]?.keys.forEach((k) => set.add(k.t));
  return [...set].sort((a, b) => a - b);
}

/** Durée totale (ms) = plus grand temps de clé (0 si aucune). */
export function animDuration(anim: CameraAnimV2): number {
  let max = 0;
  for (const id of CHANNEL_IDS) for (const k of anim.channels[id]?.keys ?? []) if (k.t > max) max = k.t;
  return max;
}

/** Durée de lecture effective (ms) : override `durationMs` s'il est > 0, sinon le dernier temps de clé. */
export function animPlayDuration(anim: CameraAnimV2): number {
  return anim.durationMs && anim.durationMs > 0 ? anim.durationMs : animDuration(anim);
}

/** Fixe la durée de lecture réglable (0/undefined = automatique = dernier temps de clé). */
export function setAnimDuration(anim: CameraAnimV2, durationMs: number | undefined): CameraAnimV2 {
  const next = { ...anim };
  if (durationMs && durationMs > 0) next.durationMs = Math.round(durationMs);
  else delete next.durationMs;
  return next;
}

/** Une animation est jouable dès qu'au moins un canal a 2 clés à des temps distincts. */
export function hasAnimation(anim: CameraAnimV2): boolean {
  return animKeyTimes(anim).length >= 2;
}

const sortKeys = (keys: CurveKey[]): CurveKey[] => [...keys].sort((a, b) => a.t - b.t);

/** Copie profonde légère d'un canal (immutabilité des opérations) — extrapolations comprises. */
const cloneChannel = (ch: Channel | undefined): Channel => ({
  ...ch,
  keys: ch ? ch.keys.map((k) => ({ ...k })) : [],
});

/**
 * Applique une mutation à un canal cloné, re-trie ses clés et rend une animation neuve. Exportée
 * pour les opérations de tangente (`tangents.ts`) : elles ont besoin de la liste complète des clés
 * du canal pour matérialiser une pente, ce qu'une mutation clé par clé ne permet pas.
 */
export function updateChannel(anim: CameraAnimV2, id: ChannelId, mut: (ch: Channel) => void): CameraAnimV2 {
  const ch = cloneChannel(anim.channels[id]);
  mut(ch);
  ch.keys = sortKeys(ch.keys);
  const channels = { ...anim.channels };
  if (ch.keys.length) channels[id] = ch;
  else delete channels[id];
  return { ...anim, channels };
}

/** Insère/écrase une clé dans un canal au temps `t` (mode par défaut `auto`). */
export function upsertKey(
  anim: CameraAnimV2,
  id: ChannelId,
  t: number,
  v: number,
  mode: TangentMode = 'auto',
): CameraAnimV2 {
  return updateChannel(anim, id, (ch) => {
    const existing = ch.keys.find((k) => k.t === t);
    if (existing) {
      existing.v = v;
    } else {
      ch.keys.push({ t, v, mode });
    }
  });
}

/** Insère/écrase une clé **complète** (mode + tangentes) au temps `key.t` d'un canal (copier/coller 40.E). */
export function upsertFullKey(anim: CameraAnimV2, id: ChannelId, key: CurveKey): CameraAnimV2 {
  return updateChannel(anim, id, (ch) => {
    const idx = ch.keys.findIndex((k) => k.t === key.t);
    if (idx >= 0) ch.keys[idx] = { ...key };
    else ch.keys.push({ ...key });
  });
}

/** Pose complète → une clé par canal renseigné, au temps `t` (bouton « poser une clé »). */
export function upsertPoseAt(
  anim: CameraAnimV2,
  t: number,
  pose: SplatCamera,
  mode: TangentMode = 'auto',
): CameraAnimV2 {
  let next = anim;
  const values = poseToChannelValues(pose);
  for (const id of CHANNEL_IDS) {
    const v = values[id];
    if (v != null) next = upsertKey(next, id, t, v, mode);
  }
  return next;
}

/** Déplace une clé (temps et/ou valeur) — le tri est maintenu. */
export function moveKey(
  anim: CameraAnimV2,
  id: ChannelId,
  index: number,
  patch: { t?: number; v?: number },
): CameraAnimV2 {
  return updateChannel(anim, id, (ch) => {
    const k = ch.keys[index];
    if (!k) return;
    if (patch.t != null) k.t = Math.max(0, patch.t);
    if (patch.v != null) k.v = patch.v;
  });
}

export function deleteKey(anim: CameraAnimV2, id: ChannelId, index: number): CameraAnimV2 {
  return updateChannel(anim, id, (ch) => ch.keys.splice(index, 1));
}

/** Une clé désignée par (canal, index) — sélection du graph editor (Phase 27). */
export interface KeyRef {
  channel: ChannelId;
  index: number;
}

/**
 * Déplace en **un seul passage** plusieurs clés (multi-sélection) désignées par leur index
 * **dans `anim`** (le baseline capturé au début du drag) vers de nouvelles valeurs t/v. Applique
 * toutes les modifications par canal avant de re-trier — les index restent cohérents pendant tout
 * le geste. Pur/testable.
 */
export function moveKeysBatch(
  anim: CameraAnimV2,
  moves: Array<{ channel: ChannelId; index: number; t: number; v: number }>,
): CameraAnimV2 {
  const byChannel = new Map<ChannelId, Map<number, { t: number; v: number }>>();
  for (const m of moves) {
    let idxMap = byChannel.get(m.channel);
    if (!idxMap) byChannel.set(m.channel, (idxMap = new Map()));
    idxMap.set(m.index, { t: Math.max(0, Math.round(m.t)), v: m.v });
  }
  const channels = { ...anim.channels };
  for (const [id, idxMap] of byChannel) {
    const ch = cloneChannel(anim.channels[id]);
    idxMap.forEach((patch, index) => {
      const k = ch.keys[index];
      if (k) {
        k.t = patch.t;
        k.v = patch.v;
      }
    });
    ch.keys = sortKeys(ch.keys);
    channels[id] = ch;
  }
  return { ...anim, channels };
}

/** Supprime en un passage un lot de clés (multi-sélection). Retire de la fin pour ne pas décaler. */
export function deleteKeys(anim: CameraAnimV2, refs: readonly KeyRef[]): CameraAnimV2 {
  const byChannel = new Map<ChannelId, number[]>();
  for (const r of refs) {
    const list = byChannel.get(r.channel) ?? [];
    list.push(r.index);
    byChannel.set(r.channel, list);
  }
  let next = anim;
  for (const [id, indices] of byChannel) {
    next = updateChannel(next, id, (ch) => {
      for (const index of [...indices].sort((a, b) => b - a)) ch.keys.splice(index, 1);
    });
  }
  return next;
}

/**
 * Règle l'extrapolation d'un canal hors de ses clés (pré/post-infinity). `constant` efface le
 * réglage : le canal retrouve la forme d'origine, où rien n'était persisté.
 */
export function setChannelExtrapolation(
  anim: CameraAnimV2,
  id: ChannelId,
  patch: { pre?: Extrapolation; post?: Extrapolation },
): CameraAnimV2 {
  return updateChannel(anim, id, (ch) => {
    for (const side of ['pre', 'post'] as const) {
      const next = patch[side];
      if (next === undefined) continue;
      if (next === 'constant') delete ch[side];
      else ch[side] = next;
    }
  });
}

/** Supprime toutes les clés au temps `t` (± tolérance) sur tous les canaux (colonne dopesheet). */
export function deleteColumn(anim: CameraAnimV2, t: number, tol = 1): CameraAnimV2 {
  let next = anim;
  for (const id of CHANNEL_IDS) {
    const ch = next.channels[id];
    if (!ch) continue;
    const idx = ch.keys.findIndex((k) => Math.abs(k.t - t) <= tol);
    if (idx >= 0) next = deleteKey(next, id, idx);
  }
  return next;
}

/** Décale toutes les clés d'un temps `t` de `deltaMs` (retiming d'une colonne dopesheet). */
export function moveColumn(anim: CameraAnimV2, t: number, deltaMs: number, tol = 1): CameraAnimV2 {
  let next = anim;
  for (const id of CHANNEL_IDS) {
    const ch = next.channels[id];
    if (!ch) continue;
    const idx = ch.keys.findIndex((k) => Math.abs(k.t - t) <= tol);
    if (idx >= 0) next = moveKey(next, id, idx, { t: ch.keys[idx].t + deltaMs });
  }
  return next;
}

/** Vecteur 3D exploitable dans une donnée réseau : trois coordonnées finies. */
const isVec3 = (v: unknown): boolean => {
  const p = v as Record<string, unknown> | null;
  return !!p && typeof p === 'object' && ['x', 'y', 'z'].every((k) => Number.isFinite(p[k]));
};

// ── Conversion depuis le format v1 (keyframes { t, pose, easing }) ──────────────
const easingToMode = (easing: string): TangentMode => (easing === 'linear' ? 'linear' : 'auto');

/** Convertit une animation v1 (poses + easing par segment) en v2 par canaux. */
export function fromV1(keyframes: SplatCameraKeyframe[], loop: boolean): CameraAnimV2 {
  let anim = emptyAnim(loop);
  for (const kf of keyframes) anim = upsertPoseAt(anim, kf.t, kf.pose, easingToMode(kf.easing));
  return anim;
}

/**
 * Normalise une animation persistée/jointe possiblement au format v1 vers v2 (aucune contrainte de
 * continuité de données : on migre à la lecture). Accepte une forme inconnue (données réseau
 * anciennes ou nouvelles). Renvoie `null` si vide/non exploitable.
 */
export function normalizeAnim(input: unknown): CameraAnimV2 | null {
  if (!input || typeof input !== 'object') return null;
  const a = input as { version?: number; keyframes?: SplatCameraKeyframe[]; loop?: boolean };
  if (a.version === 2) {
    const v2 = input as CameraAnimV2;
    if (!hasAnimation(v2)) return null;
    // Base illisible (donnée forgée) : on la retire au lieu de faire tomber la boucle de rendu sur
    // `base.position.x`. Le repli dynamique reprend — soit le comportement d'avant la base.
    if (v2.base != null && !(isVec3(v2.base.position) && isVec3(v2.base.target)))
      return { ...v2, base: undefined };
    return v2;
  }
  if (Array.isArray(a.keyframes) && a.keyframes.length >= 2) return fromV1(a.keyframes, !!a.loop);
  return null;
}

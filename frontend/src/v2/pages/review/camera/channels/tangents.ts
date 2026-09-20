// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  updateChannel,
  type CameraAnimV2,
  type ChannelId,
  type CurveKey,
  type KeyRef,
  type TangentMode,
  type TangentType,
} from './model';

/**
 * Sémantique des tangentes des F-curves (Phase 50, lot 7) : **côtés entrant et sortant séparés**,
 * profils (lissé, linéaire, plat, palier, libre), poignées brisées/unifiées et pondérées. Pur et
 * testable — la lecture vit dans `hermite.ts`, l'état dans `useCameraAnim`.
 *
 * Trois règles portent tout le fichier.
 *
 * 1. **Les formules ne changent pas.** `autoSlope` est la pente Catmull-Rom d'origine, au caractère
 *    près : une présentation caméra est persistée par média et rejouée pour tous les spectateurs —
 *    changer la formule modifierait rétroactivement des mises en scène validées par des gens.
 *
 * 2. **Un côté absent retombe sur `mode`.** Les clés enregistrées avant les côtés séparés ne portent
 *    que le mode unifié : `typeIn`/`typeOut` le relisent tel quel. Aucune donnée n'est réécrite —
 *    la migration se fait à la lecture, comme `normalizeAnim`.
 *
 * 3. **Matérialisation avant toute divergence.** Dès qu'une clé cesse d'être décrite par un seul
 *    mode legacy, on écrit dans `tin`/`tout` **la pente que la lecture calculait déjà**, et `mode`
 *    prend la valeur `free`. Un lecteur qui ignore les côtés séparés (schéma Zod du serveur,
 *    animation déjà jointe à un commentaire) retrouve donc la même courbe. C'est aussi la
 *    correction du défaut constaté : tirer UNE poignée passait la clé en `free` sans écrire l'autre
 *    côté, relu comme 0 — la courbe s'aplatissait brutalement. Seule limite connue de l'invariant :
 *    un palier côté sortant impose `mode: 'step'`, et le lecteur ancien relit alors le côté entrant
 *    en lissé même s'il est plat.
 */

/** Côté d'une tangente. */
export type TangentSide = 'in' | 'out';

/** Cible d'une application de profil : un côté, ou les deux (qui unifie la clé). */
export type TangentTarget = TangentSide | 'both';

/** Profils proposés à l'utilisateur, dans l'ordre du sélecteur. */
export const TANGENT_TYPES: readonly TangentType[] = ['auto', 'linear', 'flat', 'step', 'free'];

/**
 * Bornes de pondération. La somme des deux poids d'un segment reste ≤ 3 : au-delà, les points de
 * contrôle se croisent en x et la courbe cesse d'être une fonction du temps.
 */
const MIN_WEIGHT = 0.05;
const MAX_WEIGHT = 1.5;

/** Ramène un poids dans les bornes qui gardent le segment lisible. */
export const clampWeight = (w: number): number => Math.min(MAX_WEIGHT, Math.max(MIN_WEIGHT, w));

/** Type du côté entrant (absent = mode unifié de la clé). */
export const typeIn = (k: CurveKey): TangentType => k.modeIn ?? k.mode;
/** Type du côté sortant (absent = mode unifié de la clé). */
export const typeOut = (k: CurveKey): TangentType => k.modeOut ?? k.mode;
/** Type d'un côté donné. */
export const typeOf = (k: CurveKey, side: TangentSide): TangentType =>
  side === 'in' ? typeIn(k) : typeOut(k);

/** Poignées désolidarisées ? */
export const isBroken = (k: CurveKey): boolean => k.broken === true;
/** Tangentes pondérées (longueur de poignée signifiante) ? */
export const isWeighted = (k: CurveKey): boolean => k.wIn != null || k.wOut != null;
/** Poids d'un côté (1 = Hermite non pondéré). */
export const weightOf = (k: CurveKey, side: TangentSide): number =>
  clampWeight((side === 'in' ? k.wIn : k.wOut) ?? 1);

/** Pente lissée d'origine (Catmull-Rom sur les voisins) — formule inchangée depuis la Phase 17. */
function autoSlope(keys: readonly CurveKey[], i: number): number {
  const k = keys[i];
  const prev = keys[i - 1] ?? k;
  const next = keys[i + 1] ?? k;
  return (next.v - prev.v) / (next.t - prev.t || 1);
}

/** Pente sortante d'une clé (unités/ms) selon le type de son côté sortant. */
export function slopeOut(keys: readonly CurveKey[], i: number): number {
  const k = keys[i];
  switch (typeOut(k)) {
    case 'free':
      return k.tout ?? 0;
    case 'flat':
      return 0;
    case 'linear': {
      const n = keys[i + 1];
      return n ? (n.v - k.v) / (n.t - k.t || 1) : 0;
    }
    default:
      // `auto` et `step` : le palier court-circuite l'évaluation, sa pente n'est jamais lue.
      return autoSlope(keys, i);
  }
}

/** Pente entrante d'une clé (unités/ms) selon le type de son côté entrant. */
export function slopeIn(keys: readonly CurveKey[], i: number): number {
  const k = keys[i];
  switch (typeIn(k)) {
    case 'free':
      return k.tin ?? 0;
    case 'flat':
      return 0;
    case 'linear': {
      const p = keys[i - 1];
      return p ? (k.v - p.v) / (k.t - p.t || 1) : 0;
    }
    default:
      return autoSlope(keys, i);
  }
}

/** Pente d'un côté donné. */
export const slopeOf = (keys: readonly CurveKey[], i: number, side: TangentSide): number =>
  side === 'in' ? slopeIn(keys, i) : slopeOut(keys, i);

/** Mode unifié qui décrit le mieux une clé à côtés séparés (cf. règle 3 de l'en-tête). */
function legacyMode(k: CurveKey): TangentMode {
  const a = typeIn(k);
  const b = typeOut(k);
  if (b === 'step') return 'step';
  if (a === b && (a === 'auto' || a === 'linear')) return a;
  return 'free';
}

/**
 * Referme une clé après édition : matérialise `tin`/`tout` quand la clé n'est plus décrite par un
 * mode legacy simple, puis réécrit `mode`. À appeler après **toute** mutation de côté.
 */
function seal(keys: CurveKey[], i: number): void {
  const k = keys[i];
  const mode = legacyMode(k);
  if (mode === 'free') {
    k.tin = slopeIn(keys, i);
    k.tout = slopeOut(keys, i);
  } else {
    delete k.tin;
    delete k.tout;
  }
  k.mode = mode;
}

/** Écrit un type sur un côté, en matérialisant la pente courante quand le type devient `free`. */
function writeType(keys: CurveKey[], i: number, side: TangentSide, type: TangentType): void {
  const k = keys[i];
  // `free` part de la forme actuelle, jamais de zéro : c'est ce que fait un DCC quand on brise
  // une tangente lissée — la poignée apparaît là où la courbe passait.
  if (side === 'in') {
    if (type === 'free') k.tin = slopeIn(keys, i);
    k.modeIn = type;
  } else {
    if (type === 'free') k.tout = slopeOut(keys, i);
    k.modeOut = type;
  }
}

/** Regroupe des références de clés par canal (une seule passe de mutation par canal). */
function byChannel(refs: readonly KeyRef[]): Map<ChannelId, number[]> {
  const map = new Map<ChannelId, number[]>();
  for (const r of refs) {
    const list = map.get(r.channel);
    if (list) list.push(r.index);
    else map.set(r.channel, [r.index]);
  }
  return map;
}

/** Applique une mutation à chaque clé désignée, canal par canal, avec la liste complète des clés. */
function editKeys(
  anim: CameraAnimV2,
  refs: readonly KeyRef[],
  mut: (keys: CurveKey[], i: number) => void,
): CameraAnimV2 {
  let next = anim;
  for (const [id, indices] of byChannel(refs)) {
    next = updateChannel(next, id, (ch) => {
      for (const i of indices) {
        if (!ch.keys[i]) continue;
        mut(ch.keys, i);
        seal(ch.keys, i);
      }
    });
  }
  return next;
}

/** Toutes les clés d'un canal, en références — appliquer un profil à une courbe entière. */
export const channelRefs = (anim: CameraAnimV2, id: ChannelId): KeyRef[] =>
  (anim.channels[id]?.keys ?? []).map((_, index) => ({ channel: id, index }));

/**
 * Applique un profil de tangente à un lot de clés (sélection, courbe entière, plusieurs courbes).
 * `step` s'écrit toujours côté sortant — un palier tient jusqu'à la clé suivante. Une application
 * sur les deux côtés **unifie** la clé ; sur un seul côté, elle la **brise** si les types diffèrent.
 */
export function setTangentType(
  anim: CameraAnimV2,
  refs: readonly KeyRef[],
  type: TangentType,
  target: TangentTarget = 'both',
): CameraAnimV2 {
  const scope: TangentTarget = type === 'step' ? 'out' : target;
  return editKeys(anim, refs, (keys, i) => {
    if (scope !== 'out') writeType(keys, i, 'in', type);
    if (scope !== 'in') writeType(keys, i, 'out', type);
    const k = keys[i];
    // L'intention de l'utilisateur (`target`) décide de la brisure, pas la coercition du palier :
    // demander « palier » sur les deux côtés ne doit pas laisser la clé marquée brisée.
    if (target === 'both') delete k.broken;
    else if (typeIn(k) !== typeOut(k)) k.broken = true;
  });
}

/**
 * Brise ou unifie les poignées d'un lot de clés. Unifier aligne les deux côtés sur un même type
 * (celui du côté sortant, sauf palier) et, s'il est libre, sur la moyenne des deux pentes.
 */
export function setBroken(anim: CameraAnimV2, refs: readonly KeyRef[], broken: boolean): CameraAnimV2 {
  return editKeys(anim, refs, (keys, i) => {
    const k = keys[i];
    if (broken) {
      k.broken = true;
      return;
    }
    delete k.broken;
    const common = typeOut(k) === 'step' ? typeIn(k) : typeOut(k);
    if (common === 'free') {
      const mid = (slopeIn(keys, i) + slopeOut(keys, i)) / 2;
      k.tin = mid;
      k.tout = mid;
    }
    k.modeIn = common;
    k.modeOut = common;
  });
}

/**
 * Active ou coupe la pondération d'un lot de clés. À l'activation, les poids valent 1 : la courbe
 * ne bouge pas (un Hermite est exactement le Bézier de poids 1), seule la poignée devient
 * étirable — c'est ce que fait un DCC.
 */
export function setWeighted(anim: CameraAnimV2, refs: readonly KeyRef[], weighted: boolean): CameraAnimV2 {
  return editKeys(anim, refs, (keys, i) => {
    const k = keys[i];
    if (weighted) {
      k.wIn ??= 1;
      k.wOut ??= 1;
    } else {
      delete k.wIn;
      delete k.wOut;
    }
  });
}

/**
 * Écrit la pente (et le poids, si la clé est pondérée) d'un côté — drag d'une poignée. Une clé
 * **unifiée** fait tourner les deux côtés ensemble ; une clé **brisée** ne bouge que du côté tiré.
 * Le côté conservé garde sa pente lue, jamais zéro (cf. règle 3).
 */
export function setTangentSlope(
  anim: CameraAnimV2,
  id: ChannelId,
  index: number,
  side: TangentSide,
  slope: number,
  weight?: number,
): CameraAnimV2 {
  return updateChannel(anim, id, (ch) => {
    const k = ch.keys[index];
    if (!k) return;
    // Un palier ne se laisse pas emporter par la poignée jumelle : il tiendrait plus de sens à
    // disparaître d'un clic sur un profil qu'au détour d'un geste sur l'autre côté.
    const sides = (['in', 'out'] as const).filter(
      (s) => s === side || (!k.broken && typeOf(k, s) !== 'step'),
    );
    for (const s of sides) {
      writeType(ch.keys, index, s, 'free');
      if (s === 'in') {
        k.tin = slope;
        if (weight != null) k.wIn = clampWeight(weight);
      } else {
        k.tout = slope;
        if (weight != null) k.wOut = clampWeight(weight);
      }
    }
    seal(ch.keys, index);
  });
}

/**
 * Longueur temporelle (ms) de la poignée d'un côté quand la clé est **pondérée** : le poids
 * multiplie le tiers du segment voisin (forme Bézier). `null` si la clé ne l'est pas — la poignée
 * garde alors sa longueur d'écran fixe.
 */
export function handleSpanMs(keys: readonly CurveKey[], i: number, side: TangentSide): number | null {
  const k = keys[i];
  const w = side === 'in' ? k.wIn : k.wOut;
  if (w == null) return null;
  const nb = side === 'in' ? keys[i - 1] : keys[i + 1];
  if (!nb) return null;
  return (clampWeight(w) * Math.abs(nb.t - k.t)) / 3;
}

/** Poids correspondant à une longueur de poignée tirée (ms), borné. `null` si le poids n'a pas de sens. */
export function weightFromSpan(
  keys: readonly CurveKey[],
  i: number,
  side: TangentSide,
  spanMs: number,
): number | null {
  const nb = side === 'in' ? keys[i - 1] : keys[i + 1];
  const dt = nb ? Math.abs(nb.t - keys[i].t) : 0;
  if (!(dt > 0)) return null;
  return clampWeight((3 * Math.abs(spanMs)) / dt);
}

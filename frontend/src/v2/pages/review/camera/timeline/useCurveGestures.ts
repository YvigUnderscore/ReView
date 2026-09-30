// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useRef, useState } from 'react';
import type { CameraAnimV2, ChannelId, KeyRef } from '../channels/model';
import { keyBounds, scaleFactor, scaleKeyMoves, type KeyBounds } from '../channels/scaleKeys';
import { weightFromSpan, type TangentSide } from '../channels/tangents';
import type { ScaleGrip } from './TransformBox';
import {
  snapToFrame,
  timeToX,
  valueToY,
  xToTime,
  yToValue,
  type TimeView,
  type ValueView,
} from './viewTransform';

/** En deçà, un rubber-band n'a pas bougé : le geste vaut un simple clic (scrub). */
const BAND_CLICK_PX = 3;
/** Sous cet écart temporel, la pente d'une tangente n'a plus de sens (division instable). */
const MIN_SLOPE_DT = 1e-3;
/** Sous cette distance au pivot, un facteur d'échelle n'a plus de sens (une frame en temps). */
const MIN_SCALE_DT = 1;

/** Origine d'un déplacement groupé : clé (canal+index) et ses valeurs de départ (baseline). */
interface KeyOrigin {
  channel: ChannelId;
  index: number;
  t0: number;
  v0: number;
}

/** Côté de tangente manipulé — le type canonique vit avec leur sémantique (`channels/tangents`). */
export type { TangentSide };

/** Rectangle du rubber-band, en pixels locaux du SVG. */
export interface BandRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Déplacement groupé demandé au modèle (recalculé depuis la baseline à chaque frame du geste). */
export interface KeyMove {
  channel: ChannelId;
  index: number;
  t: number;
  v: number;
}

/**
 * Geste en cours. Union volontairement ouverte : un geste à venir (boîte de transformation, zoom
 * vertical au drag, poignées de pré/post-infinity) s'ajoute ici et dans `onPointerMove`, sans
 * toucher au rendu du canvas.
 */
type DragState =
  | { kind: 'keys'; baseline: CameraAnimV2; tDown: number; vDown: number; origins: KeyOrigin[] }
  | {
      kind: 'scale';
      baseline: CameraAnimV2;
      refs: readonly KeyRef[];
      grip: ScaleGrip;
      pivotT: number;
      pivotV: number;
      fromT: number;
      fromV: number;
    }
  | { kind: 'tangent'; side: TangentSide; channel: ChannelId; index: number }
  | { kind: 'pan'; x: number; y: number }
  | { kind: 'band'; x0: number; y0: number };

/** Une clé (canal + index) appartient-elle à la sélection ? */
export const inSel = (sel: readonly KeyRef[], id: ChannelId, i: number) =>
  sel.some((s) => s.channel === id && s.index === i);

/** Sorties du modèle appelées par les gestes — l'état vit dans `useCameraAnim`. */
export interface CurveGestureCallbacks {
  onScrub: (t: number) => void;
  onSelect: (sel: KeyRef[]) => void;
  onBeginStroke: () => void;
  onMoveKeys: (baseline: CameraAnimV2, moves: KeyMove[]) => void;
  /** Pente (et poids, si la clé est pondérée) d'un côté de tangente — cf. `setTangentSlope`. */
  onSetTangent: (
    channel: ChannelId,
    index: number,
    side: TangentSide,
    slope: number,
    weight?: number,
  ) => void;
  /** Pan de la vue au bouton du milieu (temps en ms, valeur en unités du canal). */
  onPanView?: (deltaMs: number, deltaV: number) => void;
}

/**
 * Gestes du graph editor F-curves (Phase 17/27) : déplacement groupé de clés, sélection au
 * rubber-band et manipulation des poignées de tangente. Le canvas ne garde que le rendu et branche
 * les surfaces renvoyées.
 *
 * Deux pièges portés par ce hook :
 * - la **baseline** (animation au pointerdown) est capturée une fois et rejouée à chaque frame : les
 *   index de clés restent cohérents pendant tout le déplacement (Phase 27) ;
 * - le **pointer capture** est posé sur l'élément qui a reçu le pointerdown (clé, poignée ou fond),
 *   sinon un geste relâché hors du cadre reste collé au pointeur.
 */
export function useCurveGestures(
  opts: {
    anim: CameraAnimV2;
    timeView: TimeView;
    valueView: ValueView;
    selection: readonly KeyRef[];
    editable: boolean;
    /** Canaux dessinés : cible du rubber-band (un canal masqué ne se sélectionne pas). */
    bandChannels: readonly ChannelId[];
    /** Framerate du pipeline : les clés déplacées atterrissent SUR une frame (Alt pour libérer). */
    fps: number;
  } & CurveGestureCallbacks,
) {
  const { anim, timeView: tv, valueView: vv, selection, editable, bandChannels, fps } = opts;
  const { onScrub, onSelect, onBeginStroke, onMoveKeys, onSetTangent, onPanView } = opts;
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<DragState | null>(null);
  const [band, setBand] = useState<BandRect | null>(null);

  const localX = (clientX: number) => clientX - (svgRef.current?.getBoundingClientRect().left ?? 0);
  const localY = (clientY: number) => clientY - (svgRef.current?.getBoundingClientRect().top ?? 0);
  const capture = (e: React.PointerEvent) => (e.currentTarget as SVGElement).setPointerCapture(e.pointerId);

  /**
   * Tangente : pente = (v pointeur − v clé) / (t pointeur − t clé), appliquée au côté dragué. Sur
   * une clé **pondérée**, l'éloignement du pointeur règle aussi la longueur de la poignée (poids) —
   * c'est tout l'intérêt d'une tangente pondérée.
   */
  const dragTangent = (d: Extract<DragState, { kind: 'tangent' }>, e: React.PointerEvent) => {
    const keys = anim.channels[d.channel]?.keys;
    const key = keys?.[d.index];
    if (!keys || !key) return;
    const deltaT = xToTime(localX(e.clientX), tv) - key.t;
    if (Math.abs(deltaT) < MIN_SLOPE_DT) return;
    const slope = (yToValue(localY(e.clientY), vv) - key.v) / deltaT;
    const weighted = (d.side === 'in' ? key.wIn : key.wOut) != null;
    const weight = weighted ? weightFromSpan(keys, d.index, d.side, deltaT) : null;
    onSetTangent(d.channel, d.index, d.side, slope, weight ?? undefined);
  };

  /** Temps d'une clé déplacée : sur une frame, sauf Alt (même règle que le scrub). */
  const timeOf = (t: number, free: boolean) => (free ? Math.max(0, t) : snapToFrame(t, fps));

  /**
   * Mise à l'échelle en direct : chaque axe saisi prend le rapport des distances au pivot (l'arête
   * opposée), les autres restent à 1. Passe par `onMoveKeys` — donc par la baseline du drag et
   * l'undo unique du geste, comme un déplacement ordinaire.
   */
  const dragScale = (d: Extract<DragState, { kind: 'scale' }>, e: React.PointerEvent) => {
    const onTime = d.grip === 'left' || d.grip === 'right' || d.grip === 'corner';
    const onValue = d.grip === 'top' || d.grip === 'bottom' || d.grip === 'corner';
    const toT = xToTime(localX(e.clientX), tv);
    const toV = yToValue(localY(e.clientY), vv);
    const scaleT = onTime ? scaleFactor(d.fromT, toT, d.pivotT, MIN_SCALE_DT) : 1;
    const valueEpsilon = Math.abs(vv.v1 - vv.v0) * 1e-3;
    const scaleV = onValue ? scaleFactor(d.fromV, toV, d.pivotV, valueEpsilon) : 1;
    onMoveKeys(
      d.baseline,
      scaleKeyMoves(d.baseline, d.refs, {
        pivotT: d.pivotT,
        scaleT,
        pivotV: d.pivotV,
        scaleV,
        snapTime: (t) => timeOf(t, e.altKey),
      }),
    );
  };

  /** Clés contenues dans le rectangle ; `additive` ajoute à la sélection courante (Maj). */
  const commitBand = (rect: BandRect, additive: boolean) => {
    const xMin = Math.min(rect.x0, rect.x1);
    const xMax = Math.max(rect.x0, rect.x1);
    const yMin = Math.min(rect.y0, rect.y1);
    const yMax = Math.max(rect.y0, rect.y1);
    const picked: KeyRef[] = [];
    for (const id of bandChannels) {
      anim.channels[id]?.keys.forEach((k, i) => {
        const x = timeToX(k.t, tv);
        const y = valueToY(k.v, vv);
        if (x >= xMin && x <= xMax && y >= yMin && y <= yMax) picked.push({ channel: id, index: i });
      });
    }
    onSelect(
      additive ? [...selection, ...picked.filter((p) => !inSel(selection, p.channel, p.index))] : picked,
    );
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (d.kind === 'band') {
      setBand({ x0: d.x0, y0: d.y0, x1: localX(e.clientX), y1: localY(e.clientY) });
      return;
    }
    if (d.kind === 'pan') {
      // La vue suit le pointeur : la fenêtre se déplace donc à l'inverse en temps.
      const x = localX(e.clientX);
      const y = localY(e.clientY);
      const deltaMs = (-(x - d.x) / (tv.width || 1)) * (tv.t1 - tv.t0);
      const deltaV = ((y - d.y) / (vv.height || 1)) * (vv.v1 - vv.v0);
      onPanView?.(deltaMs, deltaV);
      d.x = x;
      d.y = y;
      return;
    }
    if (d.kind === 'scale') {
      dragScale(d, e);
      return;
    }
    if (d.kind === 'keys') {
      const dt = xToTime(localX(e.clientX), tv) - d.tDown;
      const dv = yToValue(localY(e.clientY), vv) - d.vDown;
      // Snap à la frame comme le scrub et le retime de colonne — Alt libère le placement.
      const timeAt = (t0: number) => timeOf(t0 + dt, e.altKey);
      onMoveKeys(
        d.baseline,
        d.origins.map((o) => ({ channel: o.channel, index: o.index, t: timeAt(o.t0), v: o.v0 + dv })),
      );
      return;
    }
    dragTangent(d, e);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    if (d?.kind === 'band') {
      const x1 = localX(e.clientX);
      const y1 = localY(e.clientY);
      if (Math.hypot(x1 - d.x0, y1 - d.y0) > BAND_CLICK_PX)
        commitBand({ x0: d.x0, y0: d.y0, x1, y1 }, e.shiftKey);
      else onScrub(Math.max(0, xToTime(d.x0, tv)));
    }
    if (drag.current) (e.currentTarget as SVGElement).releasePointerCapture?.(e.pointerId);
    drag.current = null;
    setBand(null);
  };

  /**
   * Bouton du milieu : pan de la vue, où que soit le pointeur (usage de tous les curve editors).
   * Bouton gauche sur le **fond** du graphe (`target === currentTarget`) : rubber-band.
   */
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button === 1 && onPanView) {
      e.preventDefault();
      drag.current = { kind: 'pan', x: localX(e.clientX), y: localY(e.clientY) };
      capture(e);
      return;
    }
    if (e.button !== 0 || e.target !== e.currentTarget) return;
    drag.current = { kind: 'band', x0: localX(e.clientX), y0: localY(e.clientY) };
    capture(e);
  };

  /** Clic sur une clé : met à jour la sélection (Maj = bascule) puis arme le déplacement groupé. */
  const startKeyGesture = (e: React.PointerEvent, id: ChannelId, i: number) => {
    // Le bouton du milieu appartient au pan : il doit remonter jusqu'à la surface.
    if (e.button !== 0) return;
    e.stopPropagation();
    const already = inSel(selection, id, i);
    let next: KeyRef[];
    if (e.shiftKey)
      next = already
        ? selection.filter((s) => !(s.channel === id && s.index === i))
        : [...selection, { channel: id, index: i }];
    else next = already ? [...selection] : [{ channel: id, index: i }];
    onSelect(next);
    if (!editable || (e.shiftKey && already)) return;
    const origins: KeyOrigin[] = [];
    for (const s of next) {
      const k = anim.channels[s.channel]?.keys[s.index];
      if (k) origins.push({ channel: s.channel, index: s.index, t0: k.t, v0: k.v });
    }
    onBeginStroke();
    drag.current = {
      kind: 'keys',
      baseline: anim,
      tDown: xToTime(localX(e.clientX), tv),
      vDown: yToValue(localY(e.clientY), vv),
      origins,
    };
    capture(e);
  };

  /**
   * Clic sur une poignée de la boîte de transformation : l'arête opposée devient le pivot, et le
   * geste met la sélection à l'échelle jusqu'au relâchement.
   */
  const startScaleGesture = (e: React.PointerEvent, grip: ScaleGrip, bounds: KeyBounds) => {
    if (e.button !== 0 || !editable) return;
    e.stopPropagation();
    onBeginStroke();
    drag.current = {
      kind: 'scale',
      baseline: anim,
      refs: [...selection],
      grip,
      pivotT: grip === 'left' ? bounds.tMax : bounds.tMin,
      pivotV: grip === 'bottom' ? bounds.vMax : bounds.vMin,
      fromT: xToTime(localX(e.clientX), tv),
      fromV: yToValue(localY(e.clientY), vv),
    };
    capture(e);
  };

  /** Clic sur une poignée de tangente : arme le geste côté `in` ou `out` de la clé primaire. */
  const startTangentGesture = (e: React.PointerEvent, side: TangentSide, id: ChannelId, i: number) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    onBeginStroke();
    drag.current = { kind: 'tangent', side, channel: id, index: i };
    capture(e);
  };

  return {
    svgRef,
    /** Rubber-band en cours (à dessiner par le canvas), `null` hors geste. */
    band,
    localX,
    localY,
    /** À brancher tel quel sur le `<svg>` du graphe. */
    surface: { onPointerDown, onPointerMove, onPointerUp },
    startKeyGesture,
    startTangentGesture,
    startScaleGesture,
    /** Étendue de la sélection (boîte de transformation), `null` si elle ne désigne rien. */
    selectionBounds: keyBounds(anim, selection),
  };
}

// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useRef, useState } from 'react';
import type { CameraAnimV2, ChannelId, KeyRef } from '../channels/model';
import { timeToX, valueToY, xToTime, yToValue, type TimeView, type ValueView } from './viewTransform';

/** En deçà, un rubber-band n'a pas bougé : le geste vaut un simple clic (scrub). */
const BAND_CLICK_PX = 3;
/** Sous cet écart temporel, la pente d'une tangente n'a plus de sens (division instable). */
const MIN_SLOPE_DT = 1e-3;

/** Origine d'un déplacement groupé : clé (canal+index) et ses valeurs de départ (baseline). */
interface KeyOrigin {
  channel: ChannelId;
  index: number;
  t0: number;
  v0: number;
}

/** Côté de tangente manipulé — distinct dès maintenant (tangentes séparées à venir). */
export type TangentSide = 'in' | 'out';

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
  | { kind: 'tangent'; side: TangentSide; channel: ChannelId; index: number }
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
  onSetTangent: (channel: ChannelId, index: number, patch: { tin?: number; tout?: number }) => void;
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
  } & CurveGestureCallbacks,
) {
  const { anim, timeView: tv, valueView: vv, selection, editable, bandChannels } = opts;
  const { onScrub, onSelect, onBeginStroke, onMoveKeys, onSetTangent } = opts;
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<DragState | null>(null);
  const [band, setBand] = useState<BandRect | null>(null);

  const localX = (clientX: number) => clientX - (svgRef.current?.getBoundingClientRect().left ?? 0);
  const localY = (clientY: number) => clientY - (svgRef.current?.getBoundingClientRect().top ?? 0);
  const capture = (e: React.PointerEvent) => (e.currentTarget as SVGElement).setPointerCapture(e.pointerId);

  /** Tangente : pente = (v pointeur − v clé) / (t pointeur − t clé), appliquée au côté dragué. */
  const dragTangent = (d: Extract<DragState, { kind: 'tangent' }>, e: React.PointerEvent) => {
    const key = anim.channels[d.channel]?.keys[d.index];
    if (!key) return;
    const deltaT = xToTime(localX(e.clientX), tv) - key.t;
    if (Math.abs(deltaT) < MIN_SLOPE_DT) return;
    const slope = (yToValue(localY(e.clientY), vv) - key.v) / deltaT;
    onSetTangent(d.channel, d.index, d.side === 'out' ? { tout: slope } : { tin: slope });
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
    if (d.kind === 'keys') {
      const dt = xToTime(localX(e.clientX), tv) - d.tDown;
      const dv = yToValue(localY(e.clientY), vv) - d.vDown;
      onMoveKeys(
        d.baseline,
        d.origins.map((o) => ({ channel: o.channel, index: o.index, t: o.t0 + dt, v: o.v0 + dv })),
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

  /** Fond du graphe seulement (`target === currentTarget`) : démarre le rubber-band. */
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.target !== e.currentTarget) return;
    drag.current = { kind: 'band', x0: localX(e.clientX), y0: localY(e.clientY) };
    capture(e);
  };

  /** Clic sur une clé : met à jour la sélection (Maj = bascule) puis arme le déplacement groupé. */
  const startKeyGesture = (e: React.PointerEvent, id: ChannelId, i: number) => {
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

  /** Clic sur une poignée de tangente : arme le geste côté `in` ou `out` de la clé primaire. */
  const startTangentGesture = (e: React.PointerEvent, side: TangentSide, id: ChannelId, i: number) => {
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
  };
}

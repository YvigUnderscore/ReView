// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Géométrie du Gantt — fonctions pures, hors React, testées.
 *
 * Le défaut corrigé ici se voyait à l'écran : la barre d'une tâche commencée avant le début
 * de la fenêtre était posée à un pourcentage **négatif** (`((start - min) / span) * 100`
 * sans bornage), donc peinte hors de sa piste, par-dessus la colonne des libellés.
 *
 * La correction tient en une phrase : **on borne la barre à la fenêtre**, et non la fenêtre
 * à la barre. Une tâche qui dépasse commence au bord (`left: 0`) et le dit — `clippedStart`
 * / `clippedEnd`, dont l'écran tire un bord non arrondi — plutôt que de disparaître : une
 * tâche en cours depuis deux mois doit rester visible dans la fenêtre du mois.
 */

/** Un jour en millisecondes. */
export const DAY = 86_400_000;

/**
 * Largeur plancher d'une barre, en % de la fenêtre. Une tâche d'un seul jour sur un
 * trimestre pèse 1,1 % : sans plancher elle ne se voit pas.
 */
export const MIN_BAR_PCT = 1.5;

/** Ce que la géométrie exige d'une tâche : deux bornes, éventuellement absentes. */
export interface DatedTask {
  startDate: string | null;
  dueDate: string | null;
}

/** Intervalle absolu d'une tâche, en millisecondes. */
export interface Bar<T> {
  task: T;
  start: number;
  end: number;
}

/** Fenêtre affichée : origine et durée. `span` est toujours strictement positif. */
export interface GanttWindow {
  min: number;
  span: number;
}

/** Position d'une barre dans la fenêtre, en % — jamais hors de [0, 100]. */
export interface BarBox {
  left: number;
  width: number;
  /** La tâche commence avant la fenêtre : la barre est coupée à gauche. */
  clippedStart: boolean;
  /** La tâche finit après la fenêtre : la barre est coupée à droite. */
  clippedEnd: boolean;
  /** Faux si la tâche est entièrement hors fenêtre — rien à peindre. */
  visible: boolean;
}

/**
 * Intervalle [début, fin] d'une tâche : à défaut de l'une des bornes, on retombe sur
 * l'autre ; sans aucune borne, pas de barre. Deux bornes inversées sont remises d'aplomb.
 */
export function spanOf<T extends DatedTask>(task: T): Bar<T> | null {
  const s = task.startDate ? new Date(task.startDate).getTime() : null;
  const e = task.dueDate ? new Date(task.dueDate).getTime() : null;
  if (s === null) return e === null ? null : { task, start: e, end: e };
  if (e === null) return { task, start: s, end: s };
  return e < s ? { task, start: e, end: s } : { task, start: s, end: e };
}

/** Les barres qui touchent la fenêtre — y compris celles qui la débordent. */
export function visibleBars<T>(bars: readonly Bar<T>[], from: number, to: number): Bar<T>[] {
  return bars.filter((b) => b.end >= from && b.start <= to);
}

/**
 * Fenêtre retenue : les bornes demandées, resserrées sur les données quand celles-ci
 * n'occupent pas toute la période (un projet qui démarre dans deux semaines ne mérite pas
 * deux semaines de vide à gauche). `null` s'il n'y a rien à montrer.
 */
export function ganttWindow(
  bars: readonly { start: number; end: number }[],
  from: number,
  to: number,
): GanttWindow | null {
  if (bars.length === 0) return null;
  const min = Math.max(from, Math.min(...bars.map((b) => b.start)));
  const max = Math.min(to, Math.max(...bars.map((b) => b.end)));
  return { min, span: Math.max(max - min, DAY) };
}

/**
 * Place une barre dans la fenêtre. Tout est borné à [0, 100] : c'est ici, et non dans la
 * feuille de style, que la barre cesse de pouvoir sortir de sa piste.
 */
export function barBox(start: number, end: number, win: GanttWindow): BarBox {
  const span = Math.max(win.span, 1);
  const max = win.min + span;
  const clippedStart = start < win.min;
  const clippedEnd = end > max;

  // Entièrement hors fenêtre : on le dit, plutôt que de peindre au bord une barre qui
  // n'a rien à voir avec la période lue.
  if (end < win.min || start > max) {
    return { left: clippedStart ? 0 : 100 - MIN_BAR_PCT, width: 0, clippedStart, clippedEnd, visible: false };
  }

  const from = Math.max(start, win.min);
  const to = Math.min(Math.max(end, from), max);
  // Le plancher de largeur ne doit pas pousser la barre hors du cadre : on recule le bord
  // gauche d'abord, on borne la largeur ensuite.
  const left = Math.min(((from - win.min) / span) * 100, 100 - MIN_BAR_PCT);
  const width = Math.min(Math.max(((to - from) / span) * 100, MIN_BAR_PCT), 100 - left);
  return { left, width, clippedStart, clippedEnd, visible: true };
}

/** Graduations de l'axe, bornes incluses. */
export function ganttTicks(win: GanttWindow, count = 5): number[] {
  const steps = Math.max(count - 1, 1);
  return Array.from({ length: count }, (_, i) => win.min + (win.span * i) / steps);
}

/** Position du repère « aujourd'hui », ou `null` s'il est hors fenêtre. */
export function markerLeft(now: number, win: GanttWindow): number | null {
  if (now < win.min || now > win.min + win.span) return null;
  return ((now - win.min) / win.span) * 100;
}

/** Une piste du Gantt : une sequence et ses barres. */
export interface Group<T> {
  key: string;
  label: string;
  bars: Bar<T>[];
}

/**
 * Regroupe par sequence, tri alphabétique, les tâches sans sequence en dernier. Les barres
 * d'une piste sont ordonnées par date de début : on lit la piste de gauche à droite.
 */
export function groupBars<T extends { sequenceCode: string | null }>(
  bars: readonly Bar<T>[],
  noSequenceLabel: string,
): Group<T>[] {
  const byKey = new Map<string, Group<T>>();
  for (const bar of bars) {
    const key = bar.task.sequenceCode ?? '￿'; // tri : sans sequence en dernier
    const label = bar.task.sequenceCode ?? noSequenceLabel;
    const group = byKey.get(key);
    if (group) group.bars.push(bar);
    else byKey.set(key, { key, label, bars: [bar] });
  }
  const groups = [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
  for (const group of groups) group.bars.sort((a, b) => a.start - b.start);
  return groups;
}

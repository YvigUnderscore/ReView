// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ProductionOverview, ProductionTask } from '../../types/production';
import type { ProjectStats, ScheduleTask, ShotStat } from '../../types/api';

/**
 * Le contrat de la route de pilotage, lu en un seul endroit.
 *
 * Trois défauts corrigés côté serveur dans ce lot changent la forme de la réponse : les
 * listes d'attention sont accompagnées de leurs **totaux** (les tuiles affichaient la
 * longueur de listes plafonnées à cinquante, donc « 50 » pour trois cents tâches en
 * retard), la cadence se dédouble en deux séries d'**unités déclarées** (la projection
 * divisait un reste-à-faire en tâches par un rythme en médias publiés et annonçait une fin
 * en décembre 2028), et le planning porte le **statut du studio** plutôt que l'enum figé.
 *
 * Les miroirs de `types/production.ts`, `types/schedule.ts` et `types/stats.ts` décrivent
 * encore la réponse d'avant ; ils seront reprisés avec l'écran de la grille. D'ici là tout
 * le décalage est concentré ici — une conversion, commentée, plutôt qu'un `as` dispersé
 * dans chaque composant — et les lectures retombent sur l'ancienne forme quand le serveur
 * en face est encore l'ancien.
 */

/** Familles de statut du serveur (`lib/statusFamily`), `inactive` comprise. */
export type StatusFamily = 'todo' | 'progress' | 'review' | 'done' | 'blocked' | 'inactive';

/** Le statut du studio, tel qu'une barre le colore. */
export interface PipelineStatusRef {
  id: number;
  code: string;
  name: string;
  /** Couleur hexadécimale réglée par le studio — posée en style, jamais en classe. */
  color: string;
}

/** Tâche de planning : le miroir partagé, plus ce que le serveur ajoute dans ce lot. */
export type GanttTask = ScheduleTask & {
  pipelineStatus?: PipelineStatusRef | null;
  family?: StatusFamily;
};

/**
 * Couleur de barre par famille — le repli d'un studio qui n'a posé aucun référentiel.
 * Mêmes teintes que la matrice d'avancement, `inactive` en plus : un statut « omis » n'est
 * ni à faire ni fait, et se lit comme du gris.
 */
export const FAMILY_BAR: Record<StatusFamily, string> = {
  todo: 'bg-muted-foreground/40',
  progress: 'bg-info',
  review: 'bg-warning',
  done: 'bg-success',
  blocked: 'bg-destructive',
  inactive: 'bg-muted-foreground/20',
};

/** Traduction de l'enum figé, identique à `FAMILY_OF_ENUM` du serveur. */
export function familyOfTaskStatus(status: string): StatusFamily {
  switch (status) {
    case 'IN_PROGRESS':
      return 'progress';
    case 'PENDING_REVIEW':
      return 'review';
    case 'APPROVED':
      return 'done';
    case 'RETAKE':
    case 'REJECTED':
      return 'blocked';
    default:
      return 'todo';
  }
}

/** La famille d'une barre : celle du serveur, à défaut celle de l'enum. */
export const familyOfTask = (task: GanttTask): StatusFamily => task.family ?? familyOfTaskStatus(task.status);

// -- Attention : les totaux, pas la longueur des listes -----------------------

export interface AttentionReading {
  overdue: number;
  unassigned: number;
  waitingReview: number;
  /** Tâches DISTINCTES concernées : en retard **et** non assignée ne compte qu'une fois. */
  blocking: number;
  /** Nombre de lignes que les listes nominatives montrent effectivement. */
  shown: number;
  /** Plafond des listes, `null` si le serveur ne l'annonce pas. */
  limit: number | null;
  /** Vrai dès qu'un total dépasse ce que sa liste montre. */
  capped: boolean;
}

interface AttentionWire {
  totals?: { overdue: number; unassigned: number; waitingReview: number; blocking: number };
  limit?: number;
}

/** Les trois listes réunies — l'union dédoublonnée sert de repli au badge « ce qui bloque ». */
export function distinctBlocking(attention: {
  overdue: ProductionTask[];
  unassigned: ProductionTask[];
  waitingReview: ProductionTask[];
}): number {
  const ids = new Set<number>();
  for (const task of [...attention.overdue, ...attention.unassigned, ...attention.waitingReview]) {
    ids.add(task.id);
  }
  return ids.size;
}

export function readAttention(data: ProductionOverview): AttentionReading {
  const { overdue, unassigned, waitingReview } = data.attention;
  const wire = data.attention as AttentionWire;
  const shown = Math.max(overdue.length, unassigned.length, waitingReview.length);
  const totals = wire.totals ?? {
    overdue: overdue.length,
    unassigned: unassigned.length,
    waitingReview: waitingReview.length,
    blocking: distinctBlocking(data.attention),
  };
  const capped =
    totals.overdue > overdue.length ||
    totals.unassigned > unassigned.length ||
    totals.waitingReview > waitingReview.length;
  return { ...totals, shown, limit: wire.limit ?? null, capped };
}

// -- Cadence : deux séries, deux unités, aucune division entre elles ----------

/** Unité d'une série hebdomadaire. L'écran ne la devine pas : le serveur la déclare. */
export type PaceUnit = 'tasks' | 'media';

export interface WeekPoint {
  weekStart: string;
  count: number;
}

/** Pourquoi il n'y a pas de date projetée — une date absurde serait pire que rien. */
export type ProjectionUnavailable = 'nothing-left' | 'no-velocity' | 'nothing-counted';

export interface PaceReading {
  /** La série à tracer, et ce qu'elle compte. */
  series: WeekPoint[];
  unit: PaceUnit | null;
  done: number;
  total: number;
  percent: number;
  perWeek: number;
  /** Unité de `perWeek` — la même que `done`/`total` depuis la correction serveur. */
  perWeekUnit: PaceUnit | null;
  projectedEnd: string | null;
  unavailable: ProjectionUnavailable | null;
}

interface OverviewWire {
  pace?: { weekStart: string; count?: number; delivered?: number }[];
  delivery?: { weekStart: string; count?: number }[];
  projection?: { unit?: PaceUnit; unavailable?: ProjectionUnavailable | null };
}

const normalize = (points: { weekStart: string; count?: number; delivered?: number }[]): WeekPoint[] =>
  points.map((p) => ({ weekStart: p.weekStart, count: p.count ?? p.delivered ?? 0 }));

/**
 * La cadence telle qu'elle se lit. La série tracée est le débit de sortie (`delivery`,
 * en médias) dès que le serveur le sépare de la vélocité ; sinon la seule série qu'il
 * connaisse, dont l'unité reste alors indéterminée — et une unité indéterminée s'affiche
 * sans nom d'unité plutôt qu'avec un nom faux.
 */
export function readPace(data: ProductionOverview): PaceReading {
  const wire = data as unknown as OverviewWire;
  const { done, total, perWeek, projectedEnd } = data.projection;
  const hasDelivery = Array.isArray(wire.delivery);
  const series = normalize((hasDelivery ? wire.delivery : wire.pace) ?? []);
  const remaining = Math.max(0, total - done);
  const unavailable =
    wire.projection?.unavailable ??
    (total <= 0
      ? 'nothing-counted'
      : remaining === 0
        ? 'nothing-left'
        : projectedEnd === null
          ? 'no-velocity'
          : null);
  return {
    series,
    unit: hasDelivery ? 'media' : null,
    done,
    total,
    percent: total > 0 ? Math.round((done / total) * 100) : 0,
    perWeek,
    perWeekUnit: wire.projection?.unit ?? null,
    projectedEnd: unavailable === null ? projectedEnd : null,
    unavailable,
  };
}

// -- Retakes : ce qui tourne en rond -----------------------------------------

export interface RetakeRow {
  shotId: number;
  code: string;
  name: string;
  retakes: number;
  reviewRounds: number | null;
  reviewDays: number | null;
  openNotes: number;
}

export interface RetakeBucket {
  min: number;
  max: number | null;
  shots: number;
}

export interface RetakeReading {
  avgRetakes: number;
  avgReviewRounds: number | null;
  avgReviewDays: number | null;
  firstTimeRightRate: number | null;
  buckets: RetakeBucket[];
  /** Les plans les plus repris, le pire d'abord. */
  worst: RetakeRow[];
}

interface StatsWire {
  mostRetakenShots?: (ShotStat & { reviewRounds?: number })[];
  retakeBuckets?: RetakeBucket[];
  totals?: { avgReviewRoundsPerShot?: number; firstTimeRightRate?: number };
}

/** Classe les plans les plus repris : retakes, puis notes ouvertes, puis code. */
export function rankRetakes(shots: (ShotStat & { reviewRounds?: number })[], limit = 8): RetakeRow[] {
  return shots
    .filter((s) => s.retakes > 0)
    .sort((a, b) => b.retakes - a.retakes || b.openNotes - a.openNotes || a.code.localeCompare(b.code))
    .slice(0, limit)
    .map((s) => ({
      shotId: s.shotId,
      code: s.code,
      name: s.name,
      retakes: s.retakes,
      reviewRounds: s.reviewRounds ?? null,
      reviewDays: s.reviewDays,
      openNotes: s.openNotes,
    }));
}

/**
 * Les retakes d'un projet. Le classement vient de `mostRetakenShots` quand le serveur le
 * rend ; sinon on classe les plans les plus lents, les seuls que l'ancienne réponse
 * nommait — un classement partiel, mais jamais faux sur les plans qu'il cite.
 */
export function readRetakes(stats: ProjectStats, limit = 8): RetakeReading {
  const wire = stats as StatsWire;
  return {
    avgRetakes: stats.totals.avgRetakesPerShot,
    avgReviewRounds: wire.totals?.avgReviewRoundsPerShot ?? null,
    avgReviewDays: stats.totals.avgReviewDays,
    firstTimeRightRate: wire.totals?.firstTimeRightRate ?? null,
    buckets: wire.retakeBuckets ?? [],
    worst: rankRetakes(wire.mostRetakenShots ?? stats.slowestShots, limit),
  };
}

// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ProductionOverview, ProductionTask } from '../../types/production';
import type { ProjectStats, ScheduleTask, ShotStat } from '../../types/api';

/**
 * The contract of the control route, read in one place.
 *
 * Three defects fixed server-side in this batch change the shape of the response: the attention lists come with their
 * **totals** (the tiles displayed the length of lists capped at fifty, hence "50" for three hundred overdue tasks), the pace
 * splits into two series of **declared units** (the projection divided a remaining-work figure in tasks by a rate in
 * published media, and announced an end in December 2028), and the schedule carries the **studio's status** rather than the
 * frozen enum.
 *
 * The mirrors of `types/production.ts`, `types/schedule.ts` and `types/stats.ts` still describe the earlier response; they
 * will be patched along with the grid screen. Until then, all the mismatch is concentrated here, in one commented conversion
 * rather than a scattered `as` in each component, and the readers fall back on the old shape when the server on the other
 * end is still the old one.
 */

/** Server status families (`lib/statusFamily`), `inactive` included. */
export type StatusFamily = 'todo' | 'progress' | 'review' | 'done' | 'blocked' | 'inactive';

/** The studio's status, as a bar colours it. */
export interface PipelineStatusRef {
  id: number;
  code: string;
  name: string;
  /** Hex colour set by the studio: applied as style, never as a class. */
  color: string;
}

/** Schedule task: the shared mirror, plus what the server adds in this batch. */
export type GanttTask = ScheduleTask & {
  pipelineStatus?: PipelineStatusRef | null;
  family?: StatusFamily;
};

/**
 * Bar colour per family: the fallback for a studio that has set no reference data. Same tints as the progress matrix,
 * with `inactive` added: an "omitted" status is neither to do nor done, and reads as grey.
 */
export const FAMILY_BAR: Record<StatusFamily, string> = {
  todo: 'bg-muted-foreground/40',
  progress: 'bg-info',
  review: 'bg-warning',
  done: 'bg-success',
  blocked: 'bg-destructive',
  inactive: 'bg-muted-foreground/20',
};

/** Translation of the frozen enum, identical to the server's `FAMILY_OF_ENUM`. */
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

/** The family of a bar: the server's, failing that the enum's. */
export const familyOfTask = (task: GanttTask): StatusFamily => task.family ?? familyOfTaskStatus(task.status);

// -- Attention: the totals, not the length of the lists -----------------------

export interface AttentionReading {
  overdue: number;
  unassigned: number;
  waitingReview: number;
  /** DISTINCT tasks concerned: overdue **and** unassigned counts only once. */
  blocking: number;
  /** Number of rows the named lists actually show. */
  shown: number;
  /** Ceiling of the lists, `null` if the server does not announce it. */
  limit: number | null;
  /** True as soon as a total exceeds what its list shows. */
  capped: boolean;
}

interface AttentionWire {
  totals?: { overdue: number; unassigned: number; waitingReview: number; blocking: number };
  limit?: number;
}

/** The three lists combined: the de-duplicated union serves as the fallback for the "what is blocking" badge. */
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

// -- Pace: two series, two units, no division between them ----------------

/** Unit of a weekly series. The screen does not guess it: the server declares it. */
export type PaceUnit = 'tasks' | 'media';

export interface WeekPoint {
  weekStart: string;
  count: number;
}

/** Why there is no projected date: an absurd date would be worse than nothing. */
export type ProjectionUnavailable = 'nothing-left' | 'no-velocity' | 'nothing-counted';

export interface PaceReading {
  /** The series to plot, and what it counts. */
  series: WeekPoint[];
  unit: PaceUnit | null;
  done: number;
  total: number;
  percent: number;
  perWeek: number;
  /** Unit of `perWeek`: the same as `done`/`total` since the server fix. */
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
 * The pace as it is read. The plotted series is the output rate (`delivery`, in media) as soon as the server separates
 * it from velocity; otherwise it is the only series the server knows, whose unit then remains undetermined. An undetermined
 * unit is displayed without a unit name rather than with a wrong one.
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

// -- Retakes: what goes round in circles -----------------------------------

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
  /** The most retaken shots, the worst first. */
  worst: RetakeRow[];
}

interface StatsWire {
  mostRetakenShots?: (ShotStat & { reviewRounds?: number })[];
  retakeBuckets?: RetakeBucket[];
  totals?: { avgReviewRoundsPerShot?: number; firstTimeRightRate?: number };
}

/** Ranks the most retaken shots: retakes, then open notes, then code. */
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
 * A project's retakes. The ranking comes from `mostRetakenShots` when the server returns it; otherwise the slowest shots
 * are ranked, the only ones the old response named: a partial ranking, but never wrong about the shots it cites.
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

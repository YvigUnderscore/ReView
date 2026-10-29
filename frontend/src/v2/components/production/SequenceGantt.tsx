// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { intlLocale, useT, type MessageKey, type Tr } from '../../i18n';
import {
  DAY,
  barBox,
  ganttTicks,
  ganttWindow,
  groupBars,
  markerLeft,
  spanOf,
  visibleBars,
  type Bar,
  type GanttWindow,
} from './ganttGeometry';
import { FAMILY_BAR, familyOfTask, type GanttTask, type StatusFamily } from './productionWire';

const fmt = (ms: number) =>
  new Date(ms).toLocaleDateString(intlLocale(), { day: '2-digit', month: '2-digit' });

/** Offered windows, in days from today. `null` = the whole project. */
const SCALES = [
  { key: 'month', days: 30 },
  { key: 'quarter', days: 90 },
  { key: 'all', days: null },
] as const;
type ScaleKey = (typeof SCALES)[number]['key'];

const SCALE_LABEL: Record<ScaleKey, MessageKey> = {
  month: 'gantt.scale.month',
  quarter: 'gantt.scale.quarter',
  all: 'gantt.scale.all',
};

const FAMILY_LABEL: Record<StatusFamily, MessageKey> = {
  todo: 'kanban.family.todo',
  progress: 'kanban.family.progress',
  review: 'kanban.family.review',
  done: 'kanban.family.done',
  blocked: 'kanban.family.blocked',
  inactive: 'kanban.family.inactive',
};

/**
 * Lightweight Gantt per sequence (43.C — №128), read-only.
 *
 * Three fixes in this batch. **Bars no longer leave their track**: a task started before the start of the window was placed
 * at a negative percentage and painted over the label column. The geometry now bounds the bar to the window
 * (`ganttGeometry`), the track carries `overflow-hidden` as a second barrier, and the cut side loses its rounding: the task
 * stays visible and says it is truncated rather than disappearing. **Colours come from the studio's reference data**
 * (`pipelineStatus`), not from the frozen six-value enum, which knows neither "end" nor "awaiting client". **A truncated
 * schedule says so**: the server caps its reading, and a wrong schedule without a warning is worse than no schedule at all.
 */
export default function SequenceGantt({
  tasks,
  truncated = false,
  limit,
}: {
  tasks: GanttTask[];
  /** The server reached its cap: some tasks are missing. */
  truncated?: boolean;
  /** Cap announced by the server; otherwise, what is actually displayed. */
  limit?: number;
}) {
  const t = useT();
  // "Now" captured once (pure render) for the day marker.
  const [now] = useState(() => Date.now());
  const [scale, setScale] = useState<ScaleKey>('quarter');
  const windowDays = SCALES.find((s) => s.key === scale)?.days ?? null;

  const view = useMemo(() => {
    const all = tasks.map((task) => spanOf(task)).filter((b): b is Bar<GanttTask> => b !== null);
    // The window starts one week back: what has just finished stays visible.
    const from = windowDays === null ? -Infinity : now - 7 * DAY;
    const to = windowDays === null ? Infinity : now + windowDays * DAY;
    const bars = visibleBars(all, from, to);
    const win = ganttWindow(bars, from, to);
    if (!win) return null;
    return { win, groups: groupBars(bars, t('shots.noSequence')), ticks: ganttTicks(win) };
  }, [tasks, t, now, windowDays]);

  const scaleSwitch = (
    <div className="inline-flex rounded-md border border-border p-0.5">
      {SCALES.map((s) => (
        <button
          key={s.key}
          type="button"
          onClick={() => setScale(s.key)}
          className={`rounded px-2 py-0.5 text-2xs transition-colors ${
            scale === s.key ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {t(SCALE_LABEL[s.key])}
        </button>
      ))}
    </div>
  );

  const warning = truncated ? (
    <p className="mb-2 flex items-start gap-1.5 text-2xs text-warning">
      <AlertTriangle size={13} className="mt-px shrink-0" />
      {t('gantt.truncated', { value: (limit ?? tasks.length).toLocaleString(intlLocale()) })}
    </p>
  ) : null;

  if (view === null) {
    return (
      <section className="rounded-lg border border-border bg-card p-4">
        <div className="mb-2 flex justify-end">{scaleSwitch}</div>
        {warning}
        <p className="text-xs text-muted-foreground">{t('stats.noDatedTask')}</p>
      </section>
    );
  }

  const todayLeft = markerLeft(now, view.win);

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="mb-2 flex justify-end">{scaleSwitch}</div>
      {warning}

      {/* Time axis */}
      <div className="grid grid-cols-[140px_1fr] gap-x-3">
        <div />
        <div className="relative mb-2 h-4 text-2xs text-muted-foreground">
          {view.ticks.map((tick, i) => (
            <span
              key={tick}
              className="absolute -translate-x-1/2"
              style={{ left: `${(i / (view.ticks.length - 1)) * 100}%` }}
            >
              {fmt(tick)}
            </span>
          ))}
        </div>
      </div>

      {/* Day marker: a single line spanning the whole height. It used to be redrawn in each row, that is as
          many slightly offset lines. */}
      <div className="relative">
        {todayLeft !== null && (
          <div
            aria-hidden
            className="pointer-events-none absolute bottom-0 top-0 z-10 w-px bg-primary/60"
            style={{ left: `calc(140px + 0.75rem + (100% - 140px - 0.75rem) * ${todayLeft / 100})` }}
          />
        )}

        <div className="space-y-4">
          {view.groups.map((g) => (
            <div key={g.key}>
              <div className="mb-1 text-xs font-semibold">{g.label}</div>
              <div className="space-y-1">
                {g.bars.map((bar) => (
                  <GanttRow key={bar.task.id} bar={bar} win={view.win} t={t} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/** A task: its label on the left, its bar in the track, never outside it. */
function GanttRow({ bar, win, t }: { bar: Bar<GanttTask>; win: GanttWindow; t: Tr }) {
  const box = barBox(bar.start, bar.end, win);
  const status = bar.task.pipelineStatus;
  const family = familyOfTask(bar.task);
  const clipped = [
    box.clippedStart ? t('gantt.startsBefore') : null,
    box.clippedEnd ? t('gantt.endsAfter') : null,
  ].filter((s): s is string => s !== null);
  const title = [
    `${status?.name ?? t(FAMILY_LABEL[family])} · ${fmt(bar.start)} → ${fmt(bar.end)}`,
    ...clipped,
  ].join(' · ');

  return (
    <div className="grid grid-cols-[140px_1fr] items-center gap-x-3">
      <Link
        to={`/tasks/${bar.task.id}`}
        className="truncate text-xs hover:text-primary"
        title={`${bar.task.location} · ${bar.task.name}`}
      >
        {bar.task.location && <span className="text-muted-foreground">{bar.task.location} </span>}
        {bar.task.name}
      </Link>
      {/* `overflow-hidden`: second barrier behind the bounding in `barBox`. */}
      <div className="relative h-5 overflow-hidden rounded bg-secondary/30">
        {box.visible && (
          <Link
            to={`/tasks/${bar.task.id}`}
            title={title}
            style={{
              left: `${box.left}%`,
              width: `${box.width}%`,
              ...(status ? { backgroundColor: status.color } : {}),
            }}
            className={`absolute top-0.5 h-4 opacity-90 hover:opacity-100 ${
              status ? '' : FAMILY_BAR[family]
            } ${box.clippedStart ? '' : 'rounded-l'} ${box.clippedEnd ? '' : 'rounded-r'}`}
          />
        )}
      </div>
    </div>
  );
}

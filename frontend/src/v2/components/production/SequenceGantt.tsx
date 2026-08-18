// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { TASK_STATUS_BAR, TASK_STATUS_LABEL_KEY } from '../../lib/taskStatus';
import type { ScheduleTask } from '../../types/api';
import { useT, type MessageKey } from '../../i18n';
import { intlLocale } from '../../i18n';

const DAY = 86_400_000;
const fmt = (ms: number) =>
  new Date(ms).toLocaleDateString(intlLocale(), { day: '2-digit', month: '2-digit' });

interface Bar {
  task: ScheduleTask;
  start: number;
  end: number;
}

/** Intervalle [début, fin] d'une tâche : à défaut de l'une des bornes, on retombe sur l'autre. */
function spanOf(t: ScheduleTask): Bar | null {
  const s = t.startDate ? new Date(t.startDate).getTime() : null;
  const e = t.dueDate ? new Date(t.dueDate).getTime() : null;
  // Gardes explicites : une borne manquante est tenue par l'autre, aucune borne = pas de barre.
  if (s === null) return e === null ? null : { task: t, start: e, end: e };
  if (e === null) return { task: t, start: s, end: s };
  return e < s ? { task: t, start: e, end: s } : { task: t, start: s, end: e };
}

interface Group {
  key: string;
  label: string;
  bars: Bar[];
}

/** Fenêtres proposées, en jours à partir d'aujourd'hui. `null` = tout le projet. */
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

/**
 * Gantt léger par séquence (43.C — №128), lecture seule.
 *
 * Deux corrections (C6) : l'échelle se choisit — sur un long-métrage, « tout le projet »
 * écrase une année entière dans la largeur d'un écran et plus aucune barre n'est lisible —
 * et le repère du jour n'est plus redessiné dans chaque ligne, ce qui en faisait autant de
 * traits distincts, décalés d'un pixel par arrondi.
 */
export default function SequenceGantt({ tasks }: { tasks: ScheduleTask[] }) {
  const t = useT();
  // « Maintenant » capturé une fois (rendu pur) pour le repère du jour.
  const [now] = useState(() => Date.now());
  const [scale, setScale] = useState<ScaleKey>('quarter');
  const windowDays = SCALES.find((s) => s.key === scale)?.days ?? null;

  const { groups, min, span, ticks } = useMemo(() => {
    const all = tasks.map(spanOf).filter((b): b is Bar => b !== null);
    // La fenêtre part d'une semaine en arrière : ce qui vient de finir reste visible.
    const from = windowDays === null ? -Infinity : now - 7 * DAY;
    const to = windowDays === null ? Infinity : now + windowDays * DAY;
    const bars = all.filter((b) => b.end >= from && b.start <= to);
    if (bars.length === 0) {
      return { groups: [] as Group[], min: 0, span: 1, ticks: [] as number[] };
    }
    const min =
      windowDays === null
        ? Math.min(...bars.map((b) => b.start))
        : Math.max(from, Math.min(...bars.map((b) => b.start)));
    const max =
      windowDays === null
        ? Math.max(...bars.map((b) => b.end))
        : Math.min(to, Math.max(...bars.map((b) => b.end)));
    const span = Math.max(max - min, DAY);

    const byKey = new Map<string, Group>();
    for (const b of bars) {
      const key = b.task.sequenceCode ?? '￿'; // tri : sans séquence en dernier
      const label = b.task.sequenceCode ?? t('shots.noSequence');
      const g = byKey.get(key);
      if (g) g.bars.push(b);
      else byKey.set(key, { key, label, bars: [b] });
    }
    const groups = [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
    for (const g of groups) g.bars.sort((a, b) => a.start - b.start);

    const ticks = Array.from({ length: 5 }, (_, i) => min + (span * i) / 4);
    return { groups, min, span, ticks };
  }, [tasks, t, now, windowDays]);

  const todayLeft = groups.length && now >= min && now <= min + span ? ((now - min) / span) * 100 : null;

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

  if (groups.length === 0) {
    return (
      <section className="rounded-lg border border-border bg-card p-4">
        <div className="mb-2 flex justify-end">{scaleSwitch}</div>
        <p className="text-xs text-muted-foreground">{t('stats.noDatedTask')}</p>
      </section>
    );
  }

  const pos = (b: Bar) => ({
    left: `${((b.start - min) / span) * 100}%`,
    width: `${Math.max(((b.end - b.start) / span) * 100, 1.5)}%`,
  });

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="mb-2 flex justify-end">{scaleSwitch}</div>

      {/* Axe temporel */}
      <div className="grid grid-cols-[140px_1fr] gap-x-3">
        <div />
        <div className="relative mb-2 h-4 text-2xs text-muted-foreground">
          {ticks.map((t, i) => (
            <span key={t} className="absolute -translate-x-1/2" style={{ left: `${(i / 4) * 100}%` }}>
              {fmt(t)}
            </span>
          ))}
        </div>
      </div>

      {/* Repère du jour : un seul trait, posé sur toute la hauteur — il était redessiné
          dans chaque ligne, soit autant de traits légèrement décalés. */}
      <div className="relative">
        {todayLeft !== null && (
          <div
            aria-hidden
            className="pointer-events-none absolute bottom-0 top-0 z-10 w-px bg-primary/60"
            style={{ left: `calc(140px + 0.75rem + (100% - 140px - 0.75rem) * ${todayLeft / 100})` }}
          />
        )}

        <div className="space-y-4">
          {groups.map((g) => (
            <div key={g.key}>
              <div className="mb-1 text-xs font-semibold">{g.label}</div>
              <div className="space-y-1">
                {g.bars.map((b) => (
                  <div key={b.task.id} className="grid grid-cols-[140px_1fr] items-center gap-x-3">
                    <Link
                      to={`/tasks/${b.task.id}`}
                      className="truncate text-xs hover:text-primary"
                      title={`${b.task.location} · ${b.task.name}`}
                    >
                      {b.task.location && <span className="text-muted-foreground">{b.task.location} </span>}
                      {b.task.name}
                    </Link>
                    <div className="relative h-5 rounded bg-secondary/30">
                      <Link
                        to={`/tasks/${b.task.id}`}
                        style={pos(b)}
                        title={`${TASK_STATUS_LABEL_KEY[b.task.status] ? t(TASK_STATUS_LABEL_KEY[b.task.status]) : b.task.status} · ${fmt(b.start)} → ${fmt(b.end)}`}
                        className={`absolute top-0.5 h-4 rounded ${TASK_STATUS_BAR[b.task.status] ?? 'bg-muted-foreground/40'} opacity-90 hover:opacity-100`}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

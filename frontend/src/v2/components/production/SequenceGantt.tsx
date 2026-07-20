import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { TASK_STATUS_BAR, TASK_STATUS_LABEL } from '../../lib/taskStatus';
import type { ScheduleTask } from '../../types/api';

const DAY = 86_400_000;
const fmt = (ms: number) => new Date(ms).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });

interface Bar {
  task: ScheduleTask;
  start: number;
  end: number;
}

/** Intervalle [début, fin] d'une tâche : à défaut de l'une des bornes, on retombe sur l'autre. */
function spanOf(t: ScheduleTask): Bar | null {
  const s = t.startDate ? new Date(t.startDate).getTime() : null;
  const e = t.dueDate ? new Date(t.dueDate).getTime() : null;
  if (s === null && e === null) return null;
  let start = s ?? (e as number);
  let end = e ?? (s as number);
  if (end < start) [start, end] = [end, start];
  return { task: t, start, end };
}

interface Group {
  key: string;
  label: string;
  bars: Bar[];
}

/** Gantt léger par séquence (43.C — №128), lecture seule. Groupé par séquence, « Sans séquence » en fin. */
export default function SequenceGantt({ tasks }: { tasks: ScheduleTask[] }) {
  // « Maintenant » capturé une fois (rendu pur) pour le repère du jour.
  const [now] = useState(() => Date.now());
  const { groups, min, span, ticks } = useMemo(() => {
    const bars = tasks.map(spanOf).filter((b): b is Bar => b !== null);
    if (bars.length === 0) {
      return { groups: [] as Group[], min: 0, span: 1, ticks: [] as number[] };
    }
    const min = Math.min(...bars.map((b) => b.start));
    const max = Math.max(...bars.map((b) => b.end));
    const span = Math.max(max - min, DAY);

    const byKey = new Map<string, Group>();
    for (const b of bars) {
      const key = b.task.sequenceCode ?? '￿'; // tri : sans séquence en dernier
      const label = b.task.sequenceCode ?? 'Sans séquence';
      const g = byKey.get(key);
      if (g) g.bars.push(b);
      else byKey.set(key, { key, label, bars: [b] });
    }
    const groups = [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
    for (const g of groups) g.bars.sort((a, b) => a.start - b.start);

    const ticks = Array.from({ length: 5 }, (_, i) => min + (span * i) / 4);
    return { groups, min, span, ticks };
  }, [tasks]);

  const todayLeft = groups.length && now >= min && now <= min + span ? ((now - min) / span) * 100 : null;

  if (groups.length === 0) {
    return (
      <section className="rounded-lg border border-border bg-card p-4">
        <p className="text-xs text-muted-foreground">Aucune tâche datée à afficher.</p>
      </section>
    );
  }

  const pos = (b: Bar) => ({
    left: `${((b.start - min) / span) * 100}%`,
    width: `${Math.max(((b.end - b.start) / span) * 100, 1.5)}%`,
  });

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      {/* Axe temporel */}
      <div className="grid grid-cols-[140px_1fr] gap-x-3">
        <div />
        <div className="relative mb-2 h-4 text-[10px] text-muted-foreground">
          {ticks.map((t, i) => (
            <span key={t} className="absolute -translate-x-1/2" style={{ left: `${(i / 4) * 100}%` }}>
              {fmt(t)}
            </span>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        {groups.map((g) => (
          <div key={g.key}>
            <div className="mb-1 text-xs font-semibold">{g.label}</div>
            <div className="space-y-1">
              {g.bars.map((b) => (
                <div key={b.task.id} className="grid grid-cols-[140px_1fr] items-center gap-x-3">
                  <Link
                    to={`/tasks/${b.task.id}`}
                    className="truncate text-[11px] hover:text-primary"
                    title={`${b.task.location} · ${b.task.name}`}
                  >
                    {b.task.location && <span className="text-muted-foreground">{b.task.location} </span>}
                    {b.task.name}
                  </Link>
                  <div className="relative h-5 rounded bg-secondary/30">
                    {todayLeft !== null && (
                      <div
                        className="absolute top-0 h-full w-px bg-primary/60"
                        style={{ left: `${todayLeft}%` }}
                      />
                    )}
                    <Link
                      to={`/tasks/${b.task.id}`}
                      style={pos(b)}
                      title={`${TASK_STATUS_LABEL[b.task.status] ?? b.task.status} · ${fmt(b.start)} → ${fmt(b.end)}`}
                      className={`absolute top-0.5 h-4 rounded ${TASK_STATUS_BAR[b.task.status] ?? 'bg-muted-foreground/40'} opacity-90 hover:opacity-100`}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

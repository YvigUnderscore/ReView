// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Link } from 'react-router-dom';
import { Clock, MessageSquareWarning, RefreshCw, CheckCircle2 } from 'lucide-react';
import type { ProjectStats, SequenceConvergence, ShotStatStatus } from '../../types/api';
import { useT, type MessageKey } from '../../i18n';

/** Traducteur passé aux tables de libellés, recalculées à chaque rendu. */
type Tr = (key: MessageKey) => string;

/** Métadonnées d'affichage par statut de shot (tokens de thème uniquement). */
const statusMeta = (t: Tr): Record<ShotStatStatus, { label: string; bar: string }> => ({
  approved: { label: t('decision.approved'), bar: 'bg-success' },
  inReview: { label: t('home.mediaInReview'), bar: 'bg-info' },
  retake: { label: 'Retake', bar: 'bg-accent2' },
  notStarted: { label: t('stats.notStarted'), bar: 'bg-muted-foreground/40' },
});
const SEGMENTS: ShotStatStatus[] = ['approved', 'inReview', 'retake', 'notStarted'];

function Kpi({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

/** Barre de convergence empilée d'une séquence (approuvé / review / retake / non démarré). */
function ConvergenceRow({ seq }: { seq: SequenceConvergence }) {
  const t = useT();
  const counts: Record<ShotStatStatus, number> = {
    approved: seq.approved,
    inReview: seq.inReview,
    retake: seq.retake,
    notStarted: seq.notStarted,
  };
  const pct = seq.total ? Math.round((seq.approved / seq.total) * 100) : 0;
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
        <span className="min-w-0 truncate font-medium">
          {seq.code}
          {seq.name && seq.name !== '—' && <span className="text-muted-foreground"> · {seq.name}</span>}
        </span>
        <span className="shrink-0 tabular-nums text-muted-foreground">
          {seq.approved}/{seq.total} approuvés · {pct}%
        </span>
      </div>
      <div className="flex h-2.5 overflow-hidden rounded-full bg-secondary/40">
        {SEGMENTS.filter((s) => counts[s] > 0).map((s) => (
          <div
            key={s}
            className={`${statusMeta(t)[s].bar} transition-all`}
            style={{ width: `${(counts[s] / seq.total) * 100}%` }}
            title={`${statusMeta(t)[s].label} : ${counts[s]}`}
          />
        ))}
      </div>
    </div>
  );
}

export default function ReviewStatsPanel({ stats, projectId }: { stats: ProjectStats; projectId: number }) {
  const tr = useT();
  const t = stats.totals;
  const shotHref = (shotId: number) => `/projects/${projectId}?tab=shots&shot=${shotId}`;

  return (
    <div className="space-y-6">
      {/* Indicateurs clés */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <Kpi label={tr('shots.title')} value={String(t.shots)} />
        <Kpi label="Versions" value={String(t.versions)} />
        <Kpi
          label={tr('stats.approvalRate')}
          value={`${t.approvalRate}%`}
          icon={<CheckCircle2 size={13} className="text-success" />}
        />
        <Kpi
          label={tr('stats.openNotes')}
          value={String(t.openNotes)}
          icon={<MessageSquareWarning size={13} className="text-warning" />}
        />
        <Kpi
          label={tr('stats.avgDelay')}
          value={t.avgReviewDays === null ? '—' : `${t.avgReviewDays} j`}
          icon={<Clock size={13} className="text-info" />}
        />
        <Kpi
          label={tr('stats.retakesPerShot')}
          value={String(t.avgRetakesPerShot)}
          icon={<RefreshCw size={13} className="text-accent2" />}
        />
        <Kpi label={tr('stats.notesPerVersion')} value={String(t.avgNotesPerVersion)} />
        <Kpi label={tr('stats.decisions')} value={String(t.decisions)} />
      </div>

      {/* Convergence par séquence */}
      <section className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-3 text-sm font-semibold">{tr('stats.convergence')}</h3>
        {stats.sequences.length === 0 ? (
          <p className="text-xs text-muted-foreground">{tr('stats.noSequenceWithShots')}</p>
        ) : (
          <div className="space-y-3">
            {stats.sequences.map((seq) => (
              <ConvergenceRow key={seq.sequenceId ?? 'none'} seq={seq} />
            ))}
            <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1 text-[11px] text-muted-foreground">
              {SEGMENTS.map((s) => (
                <span key={s} className="flex items-center gap-1.5">
                  <span className={`h-2 w-2 rounded-full ${statusMeta(tr)[s].bar}`} />
                  {statusMeta(tr)[s].label}
                </span>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Shots les plus coûteux */}
      <section className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-3 text-sm font-semibold">{tr('home.shotsToWatch')}</h3>
        {stats.slowestShots.length === 0 ? (
          <p className="text-xs text-muted-foreground">{tr('stats.empty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="pb-2 font-medium">Shot</th>
                  <th className="pb-2 text-right font-medium">Versions</th>
                  <th className="pb-2 text-right font-medium">Retakes</th>
                  <th className="pb-2 text-right font-medium">{tr('stats.notes')}</th>
                  <th className="pb-2 text-right font-medium">{tr('stats.delay')}</th>
                </tr>
              </thead>
              <tbody>
                {stats.slowestShots.map((s) => (
                  <tr key={s.shotId} className="border-t border-border/60">
                    <td className="py-1.5">
                      <Link to={shotHref(s.shotId)} className="font-medium hover:text-primary">
                        {s.code}
                        <span className="text-muted-foreground"> · {s.name}</span>
                      </Link>
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{s.versions}</td>
                    <td className="py-1.5 text-right tabular-nums">
                      {s.retakes > 0 ? <span className="text-accent2">{s.retakes}</span> : '—'}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">
                      {s.openNotes > 0 ? <span className="text-warning">{s.openNotes}</span> : '—'}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">
                      {s.reviewDays === null ? '—' : `${s.reviewDays} j`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

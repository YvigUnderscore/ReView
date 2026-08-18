// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, Check, Clapperboard, Download, Pencil, Play, X } from 'lucide-react';
import { useAuth } from '../../stores/useAuth';
import { SkeletonRows } from '../../components/ui/skeleton';
import { formatDuration } from '../review/timelineNav';
import { useTimelineData } from './useTimelineData';
import TimelineTrack from './TimelineTrack';
import TimelineExportButton from './TimelineExportButton';
import { useT } from '../../i18n';

/**
 * Carte « Montage » en tête d'une séquence ou d'un projet (Phase 45).
 *
 * Elle se met à jour toute seule : le contenu est recalculé côté serveur à chaque lecture,
 * et une publication invalide la requête par socket. Personne n'a à « régénérer » quoi que
 * ce soit — c'était la demande d'origine.
 *
 * La carte montre le film en entier sur sa bande, mais ne le joue pas : le montage se
 * regarde sur sa propre page, avec l'outillage de review complet (Phase 46). Cliquer un
 * plan de la bande y entre directement au bon endroit.
 */
export default function TimelineCard({
  projectId,
  sequenceId,
}: {
  projectId: number;
  sequenceId: number | null;
}) {
  const t = useT();
  const navigate = useNavigate();
  const role = useAuth((s) => s.user?.role);
  const canManage = role === 'ADMIN' || role === 'SUPERVISOR';
  const { timeline, isLoading, rename, setDepartment, snapshot } = useTimelineData(projectId, sequenceId);
  const [editing, setEditing] = useState<string | null>(null);

  if (isLoading) return <SkeletonRows count={2} />;
  if (!timeline) return null;

  const label = timeline.name ?? t('timeline.defaultName');
  const firstPlayable = timeline.items.find((it) => it.mediaId !== null);
  const open = (at = 0) => navigate(`/timelines/${timeline.id}/play${at > 0 ? `?t=${at.toFixed(2)}` : ''}`);

  return (
    <section className="mb-4 rounded-lg border border-border bg-card p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Clapperboard size={15} className="shrink-0 text-primary" />
        {editing === null ? (
          <>
            <h3 className="text-sm font-medium">{label}</h3>
            {canManage && (
              <button
                onClick={() => setEditing(timeline.name ?? '')}
                title={t('common.rename')}
                className="text-muted-foreground hover:text-foreground"
              >
                <Pencil size={12} />
              </button>
            )}
          </>
        ) : (
          <form
            className="flex items-center gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              void rename(editing.trim() || null);
              setEditing(null);
            }}
          >
            <input
              autoFocus
              value={editing}
              onChange={(e) => setEditing(e.target.value)}
              placeholder={t('timeline.defaultName')}
              className="w-40 rounded border border-input bg-background px-2 py-1 text-xs"
            />
            <button type="submit" className="text-primary" title={t('common.save')}>
              <Check size={14} />
            </button>
            <button
              type="button"
              onClick={() => setEditing(null)}
              className="text-muted-foreground"
              title={t('common.cancel')}
            >
              <X size={14} />
            </button>
          </form>
        )}

        <span className="text-xs text-muted-foreground">
          {t('timeline.shotCount', { count: timeline.items.length })} ·{' '}
          {formatDuration(timeline.totalDuration)}
        </span>
        {timeline.gapCount > 0 && (
          <span className="rounded bg-warning/15 px-1.5 py-0.5 text-2xs text-warning">
            {t('timeline.gapCount', { count: timeline.gapCount })}
          </span>
        )}
        {timeline.latestRevision !== null && (
          <span className="rounded border border-border px-1.5 py-0.5 text-2xs text-muted-foreground">
            {t('timeline.revision', { revision: timeline.latestRevision })}
          </span>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          <select
            value={timeline.department ?? ''}
            onChange={(e) => void setDepartment(e.target.value || null)}
            disabled={!canManage}
            title={t('timeline.departmentHint')}
            className="rounded border border-input bg-background px-1.5 py-1 text-xs disabled:opacity-60"
          >
            <option value="">{t('timeline.departmentAuto')}</option>
            {timeline.departments.map((d) => (
              <option key={d.key} value={d.key}>
                {d.name}
              </option>
            ))}
          </select>
          {canManage && (
            <button
              onClick={() => void snapshot()}
              title={t('timeline.snapshotHint')}
              className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs hover:bg-secondary/60"
            >
              <Camera size={13} /> {t('timeline.snapshot')}
            </button>
          )}
          <TimelineExportButton
            timelineId={timeline.id}
            disabled={!firstPlayable}
            icon={<Download size={13} />}
          />
          <button
            onClick={() => open()}
            disabled={!firstPlayable}
            className="flex items-center gap-1 rounded bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground disabled:opacity-40"
          >
            <Play size={13} /> {t('timeline.play')}
          </button>
        </div>
      </div>

      <TimelineTrack
        items={timeline.items}
        total={timeline.totalDuration}
        time={0}
        currentIndex={-1}
        onSeek={open}
        timelineId={timeline.id}
      />
    </section>
  );
}

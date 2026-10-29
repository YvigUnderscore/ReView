// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useNavigate } from 'react-router-dom';
import { Clapperboard, Download, MoreHorizontal, Play } from 'lucide-react';
import { useAuth } from '../../stores/useAuth';
import { formatDuration } from '../review/timelineNav';
import { useTimelineData } from './useTimelineData';
import { useTimelineCardMenu } from './TimelineCardMenu';
import TimelineExportButton from './TimelineExportButton';
import EntityContextMenu from '../../components/ui/entity-menu';
import { useT } from '../../i18n';

/**
 * The montage, in one line.
 *
 * The card used to take the top of each sequence page and of the Sequences tab with a strip of
 * shots, a stage selector, a snapshot button, an export and a rename field — more room than the
 * list it was there to consult. Yet one does not edit from this card: one goes to **watch the
 * film**, and the montage is viewed on its own page with the full review tooling.
 *
 * It therefore keeps a single button — "Play the film" or "Play the sequence" depending on the
 * context — and a line of markers. Everything else (rename, pick the stage, take a revision,
 * export) goes to the right-click menu, as everywhere else in ReView.
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
  const data = useTimelineData(projectId, sequenceId);
  const { timeline, isLoading } = data;
  // The hook is called unconditionally (rules of hooks): it returns an empty list until a
  // montage has been resolved.
  const { entries, dialog } = useTimelineCardMenu(data, canManage);

  // Nothing to play, nothing to say: an empty card at the top of the page would cost the very
  // room we are trying to give back.
  if (isLoading || !timeline) return null;
  const firstPlayable = timeline.items.find((it) => it.mediaId !== null);
  const open = () => navigate(`/timelines/${timeline.id}/play`);

  return (
    <>
      <EntityContextMenu entries={entries}>
        <section className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-3 py-2">
          <Clapperboard size={15} className="shrink-0 text-primary" />
          <button
            onClick={open}
            disabled={!firstPlayable}
            className="flex items-center gap-1.5 rounded bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            <Play size={14} />
            {sequenceId === null ? t('timeline.playFilm') : t('timeline.playSequence')}
          </button>

          <span className="text-xs text-muted-foreground">
            {t('timeline.shotCount', { count: timeline.items.length })} ·{' '}
            {formatDuration(timeline.totalDuration)}
          </span>
          {/* The only two signals that call for a decision: a gap in the montage, and the current
            revision. The rest lives in the menu. */}
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

          <span className="ml-auto flex items-center gap-2">
            <TimelineExportButton
              timelineId={timeline.id}
              disabled={!firstPlayable}
              icon={<Download size={13} />}
            />
            {/* Discreet reminder: everything else about the montage lives in the right click. */}
            <span className="flex items-center gap-1 text-2xs text-muted-foreground">
              <MoreHorizontal size={14} />
              {t('timeline.moreHint')}
            </span>
          </span>
        </section>
      </EntityContextMenu>
      {dialog}
    </>
  );
}

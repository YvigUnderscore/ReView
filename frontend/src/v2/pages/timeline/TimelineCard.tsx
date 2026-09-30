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
 * Le montage, en une ligne.
 *
 * La carte occupait le haut de chaque page de séquence et de l'onglet Séquences avec une
 * bande de plans, un sélecteur d'étape, un bouton d'instantané, un export et un champ de
 * renommage — plus de place que la liste qu'on venait consulter. Or on ne monte pas depuis
 * cette carte : on va **voir le film**, et le montage se regarde sur sa propre page avec
 * l'outillage de review complet.
 *
 * Il reste donc un bouton — « Jouer le film » ou « Jouer la sequence » selon le contexte —
 * et une ligne de repères. Tout le reste (renommer, choisir l'étape, prendre une révision,
 * exporter) passe au clic droit, comme partout ailleurs dans ReView.
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
  // Le hook est appelé sans condition (règle des hooks) : il rend une liste vide tant
  // qu'aucun montage n'est résolu.
  const { entries, dialog } = useTimelineCardMenu(data, canManage);

  // Rien à jouer, rien à dire : une carte vide en tête de page coûterait la place qu'on
  // cherche précisément à rendre.
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
          {/* Les deux seuls signaux qui demandent une décision : un trou dans le montage, et
            la révision courante. Le reste vit dans le menu. */}
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
            {/* Rappel discret : tout le reste du montage vit au clic droit. */}
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

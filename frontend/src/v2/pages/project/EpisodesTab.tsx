// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowDown, ArrowUp, Clapperboard, Film, Link2Off, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import BatchGenerator from '../../components/BatchGenerator';
import ConfirmDialog from '../../components/ConfirmDialog';
import EmptyState from '../../components/ui/empty-state';
import ViewToggle from '../../components/ViewToggle';
import { useViewMode } from '../../stores/useViewPref';
import EntityCard, { EntityContainer } from '../../components/EntityCard';
import PipelineStatusBadge from '../../components/shotgrid/PipelineStatusBadge';
import { separator, type MenuEntry } from '../../lib/menuSpec';
import { useSequencesQuery } from '../../lib/queries';
import { episodePath } from '../../lib/slug';
import {
  assignSequencesToEpisode,
  createEpisodes,
  groupSequencesByEpisode,
  moveInOrder,
  reorderEpisodes,
  trashEpisode,
  useEpisodeInvalidate,
  useEpisodesQuery,
} from '../../lib/episodesApi';
import type { EpisodeSummary } from '../../types/episode';
import type { SequenceSummary } from '../../types/api';
import { useT } from '../../i18n';

/**
 * Onglet Épisodes (niveau facultatif, activé projet par projet).
 *
 * Il n'existe que sur un projet où le niveau est allumé : la page projet ne le monte pas
 * autrement. Il réutilise le motif de liste des séquences et des plans — même carte,
 * même bascule grille/liste, mêmes gestes — plutôt que d'en inventer un sixième.
 *
 * Les séquences hors épisode forment un groupe à part entière : « sans » est une réponse,
 * pas une absence, et un découpage en cours en laisse toujours.
 */

const EPISODE_PREFIX = 'EP';

export default function EpisodesTab({ projectId, canManage }: { projectId: number; canManage: boolean }) {
  const t = useT();
  const navigate = useNavigate();
  const view = useViewMode(`episodes:${projectId}`);
  const invalidate = useEpisodeInvalidate(projectId);
  const { data, isLoading, error } = useEpisodesQuery(projectId);
  const seqQuery = useSequencesQuery(projectId);
  const [deleting, setDeleting] = useState<EpisodeSummary | null>(null);

  const episodes = data?.episodes ?? [];
  const sequences = seqQuery.data?.sequences ?? [];
  const groups = groupSequencesByEpisode(episodes, sequences);
  const sequencesOf = (episodeId: number | null) =>
    groups.find((g) => g.episodeId === episodeId)?.sequences ?? [];

  const refresh = async () => {
    await invalidate();
    await seqQuery.refetch();
  };

  const runCreate = async (rows: { code: string; name: string }[]) => {
    await createEpisodes(
      projectId,
      rows.map((r) => ({ code: r.code, name: r.name || r.code })),
    );
    toast.success(t('episodes.createdCount', { count: rows.length }));
    await refresh();
  };

  const move = async (episode: EpisodeSummary, delta: number) => {
    const ids = moveInOrder(episodes, episode.id, delta);
    await reorderEpisodes(projectId, ids);
    toast.success(t('episodes.reordered'));
    await invalidate();
  };

  const attach = async (sequenceId: number, episodeId: number | null) => {
    await assignSequencesToEpisode(projectId, episodeId, [sequenceId]);
    toast.success(episodeId === null ? t('episodes.detached') : t('episodes.attached'));
    await refresh();
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    await trashEpisode(deleting.id);
    toast.success(t('episodes.trashed'));
    setDeleting(null);
    await refresh();
  };

  const menuFor = (episode: EpisodeSummary, index: number): MenuEntry[] => [
    { id: 'open', label: t('episodes.open'), onSelect: () => void navigate(episodePath(episode)) },
    ...(canManage
      ? [
          separator('order'),
          {
            id: 'up',
            label: t('common.moveUp'),
            icon: <ArrowUp size={14} />,
            disabled: index === 0,
            onSelect: () => void move(episode, -1),
          },
          {
            id: 'down',
            label: t('common.moveDown'),
            icon: <ArrowDown size={14} />,
            disabled: index === episodes.length - 1,
            onSelect: () => void move(episode, 1),
          },
          separator('manage'),
          {
            id: 'delete',
            label: t('common.moveToTrash'),
            icon: <Trash2 size={14} />,
            danger: true,
            onSelect: () => setDeleting(episode),
          },
        ]
      : []),
  ];

  /** Déplacer une séquence d'un épisode à l'autre — au clic droit, jamais par un bouton. */
  const sequenceMenu = (sequence: SequenceSummary): MenuEntry[] => {
    if (!canManage) return [];
    const targets = episodes.filter((e) => e.id !== sequence.episodeId);
    return [
      {
        kind: 'submenu',
        id: 'attach',
        label: t('episodes.attachTo'),
        icon: <Film size={14} />,
        items: targets.map((e) => ({
          id: `ep-${e.id}`,
          label: e.code,
          onSelect: () => void attach(sequence.id, e.id),
        })),
      },
      ...(sequence.episodeId != null
        ? [
            {
              id: 'detach',
              label: t('episodes.detach'),
              icon: <Link2Off size={14} />,
              onSelect: () => void attach(sequence.id, null),
            },
          ]
        : []),
    ];
  };

  const sequenceCards = (rows: SequenceSummary[]) => (
    <EntityContainer view={view}>
      {rows.map((s) => (
        <EntityCard
          key={s.id}
          view={view}
          to={`/sequences/${s.id}`}
          title={s.code}
          subtitle={t('sequence.shotCount', { count: s._count.shots })}
          thumbnailUrl={s.thumbnailUrl}
          contextEntries={sequenceMenu(s)}
        />
      ))}
    </EntityContainer>
  );

  const orphans = sequencesOf(null);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-muted-foreground">{t('episodes.title')}</h2>
        <ViewToggle contextKey={`episodes:${projectId}`} />
      </div>
      {error && <p className="mb-3 text-sm text-destructive">{error.message}</p>}

      {canManage && (
        <BatchGenerator
          defaults={{ prefix: EPISODE_PREFIX, step: 1, padding: 3 }}
          onSubmit={(items) => runCreate(items.map((it) => ({ code: it.code, name: it.name })))}
        />
      )}

      {!isLoading && episodes.length === 0 ? (
        <EmptyState
          compact
          icon={Clapperboard}
          title={t('episodes.empty.title')}
          description={canManage ? t('episodes.empty.hint') : t('episodes.empty.description')}
        />
      ) : (
        <EntityContainer view={view}>
          {episodes.map((episode, index) => (
            <EntityCard
              key={episode.id}
              view={view}
              to={episodePath(episode)}
              title={episode.code}
              subtitle={[
                episode.name === episode.code ? null : episode.name,
                t('episode.sequenceCount', { count: episode._count.sequences }),
              ]
                .filter(Boolean)
                .join(' · ')}
              thumbnailUrl={episode.thumbnailUrl}
              badge={<PipelineStatusBadge statusId={episode.pipelineStatusId} scope="sequence" size="xs" />}
              contextEntries={menuFor(episode, index)}
            />
          ))}
        </EntityContainer>
      )}

      {orphans.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground">
            {t('episodes.unassignedCount', { count: orphans.length })}
          </h2>
          <p className="mb-3 text-sm text-muted-foreground">{t('episodes.unassignedHint')}</p>
          {sequenceCards(orphans)}
        </section>
      )}

      <ConfirmDialog
        open={!!deleting}
        title={t('episodes.delete.title')}
        message={t('episodes.delete.message', { code: deleting?.code ?? '' })}
        confirmLabel={t('common.moveToTrash')}
        danger
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

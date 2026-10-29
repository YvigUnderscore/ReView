// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { Clapperboard } from 'lucide-react';
import { api } from '../../lib/apiClient';
import { qk } from '../lib/query';
import { episodePath, parseIdParam } from '../lib/slug';
import EntityWorkPage from '../components/entity/EntityWorkPage';
import { SkeletonRows } from '../components/ui/skeleton';
import TimelineCard from './timeline/TimelineCard';
import SequenceShotGrid from './sequence/SequenceShotGrid';
import SequenceAssets from './sequence/SequenceAssets';
import { useSequenceShotAdd } from './sequence/useSequenceShotAdd';
import { useProjectRole } from '../lib/useProjectRole';
import { useAddToPlaylistMenu } from '../lib/useAddToPlaylistMenu';
import { useStatusMenu } from '../lib/useStatusMenu';
import { entriesOf } from '../lib/menuSpec';
import { fetchSequenceCandidates } from '../lib/playlistApi';
import { useMarkVisited } from '../lib/useVisits';
import type { SequenceDetailData } from './project/projectTypes';
import { useT } from '../i18n';
import EntityUnavailable from '../components/EntityUnavailable';
import { isBadId, isMissingOrForbidden } from '../components/entityAvailability';

/**
 * The sequence, as a page (C3).
 *
 * It had none: it was an accordion in the Sequences tab, and its editing was
 * hidden behind an expansion. Yet it is the unit of work of an edit — one opens it to
 * see where the scene stands. Hence the order: the cut first, its shots after.
 */
export default function SequencePage() {
  const t = useT();
  const { id } = useParams();
  const sequenceId = parseIdParam(id);
  // Opening is consulting: the "not consulted" glow switches off here (batch 9).
  useMarkVisited('SEQUENCE', sequenceId);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: qk.sequence(sequenceId),
    queryFn: () =>
      api.get<{ sequence: SequenceDetailData }>(`/api/sequences/${sequenceId}`).then((d) => d.sequence),
    enabled: Number.isFinite(sequenceId),
  });
  const projectId = data?.projectId ?? 0;
  const { canManage } = useProjectRole(projectId);
  const playlistMenu = useAddToPlaylistMenu(projectId);
  // The whole sequence into the dailies: the latest published version of each of its
  // shots. The list is only requested on click — not when the page opens.
  const playlistEntry = playlistMenu.entry(async () => {
    const candidates = await fetchSequenceCandidates(projectId, sequenceId);
    return { versionIds: candidates.map((c) => c.versionId) };
  });
  const { entry: statusEntry } = useStatusMenu(projectId, 'sequence');
  // Populating the sequence: via right click first (simple UI), and through a single "+" that the
  // shot grid exposes — the main action of this screen deserves to be visible.
  const addShots = useSequenceShotAdd({
    projectId,
    sequenceId,
    canManage,
    onChanged: () => void refetch(),
  });
  const menuExtras = [
    ...addShots.entries,
    ...entriesOf(data ? statusEntry(data, { canEdit: canManage }) : null),
    ...(playlistEntry ? [playlistEntry] : []),
  ];

  // `/sequences/abc` or a deleted sequence: the page rendered its shell with no subject.
  if (isBadId(sequenceId) || (error && isMissingOrForbidden(error)))
    return <EntityUnavailable kind="sequence" error={isBadId(sequenceId) ? undefined : error} />;
  if (error) return <EntityUnavailable kind="sequence" error={error} onRetry={() => void refetch()} />;

  return (
    <EntityWorkPage
      kind="sequence"
      id={sequenceId}
      projectId={projectId}
      title={data?.code ?? `${t('sequences.title')} #${sequenceId}`}
      subtitle={data?.name !== data?.code ? data?.name : null}
      entity={data ?? {}}
      thumbnailUrl={data?.thumbnailUrl}
      statusId={data?.pipelineStatusId}
      canManage={canManage}
      menuExtras={menuExtras}
    >
      {/* Link back up to the episode — the level being optional, this link only exists on a
           project that has enabled it and a sequence attached to it. */}
      {data?.episode && (
        <Link
          to={episodePath(data.episode)}
          aria-label={t('episodes.open')}
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <Clapperboard size={14} /> {data.episode.code}
        </Link>
      )}
      {data?.description && (
        <p className="mb-5 max-w-3xl whitespace-pre-line text-sm text-muted-foreground">{data.description}</p>
      )}

      {isLoading ? (
        <SkeletonRows count={4} />
      ) : (
        data && (
          <div className="space-y-6">
            {/* The edit updates on each publication: it sits at the top, not in an annex. */}
            <TimelineCard projectId={projectId} sequenceId={sequenceId} />
            <SequenceShotGrid
              shots={data.shots}
              projectId={projectId}
              canManage={canManage}
              onChanged={() => void refetch()}
              onAdd={addShots.open}
            />
            <SequenceAssets assets={data.assets} />
          </div>
        )
      )}
      {addShots.dialog}
    </EntityWorkPage>
  );
}

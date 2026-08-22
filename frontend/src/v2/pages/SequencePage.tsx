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
import { useProjectRole } from '../lib/useProjectRole';
import { useAddToPlaylistMenu } from '../lib/useAddToPlaylistMenu';
import { useStatusMenu } from '../lib/useStatusMenu';
import { entriesOf } from '../lib/menuSpec';
import { fetchSequenceCandidates } from '../lib/playlistApi';
import type { SequenceDetailData } from './project/projectTypes';
import { useT } from '../i18n';

/**
 * La séquence, comme page (C3).
 *
 * Elle n'en avait pas : c'était un accordéon dans l'onglet Séquences, et son montage se
 * cachait derrière un dépliage. Or c'est l'unité de travail d'un montage — on l'ouvre pour
 * voir où en est la scène. D'où l'ordre : le cut d'abord, ses plans ensuite.
 */
export default function SequencePage() {
  const t = useT();
  const { id } = useParams();
  const sequenceId = parseIdParam(id);

  const { data, isLoading, error } = useQuery({
    queryKey: qk.sequence(sequenceId),
    queryFn: () =>
      api.get<{ sequence: SequenceDetailData }>(`/api/sequences/${sequenceId}`).then((d) => d.sequence),
    enabled: Number.isFinite(sequenceId),
  });
  const projectId = data?.projectId ?? 0;
  const { canManage } = useProjectRole(projectId);
  const playlistMenu = useAddToPlaylistMenu(projectId);
  // Toute la séquence dans les dailies : la dernière version publiée de chacun de ses
  // plans. La liste n'est demandée qu'au clic — pas à l'ouverture de la page.
  const playlistEntry = playlistMenu.entry(async () => {
    const candidates = await fetchSequenceCandidates(projectId, sequenceId);
    return { versionIds: candidates.map((c) => c.versionId) };
  });
  const { entry: statusEntry } = useStatusMenu(projectId, 'sequence');
  const menuExtras = [
    ...entriesOf(data ? statusEntry(data, { canEdit: canManage }) : null),
    ...(playlistEntry ? [playlistEntry] : []),
  ];

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
      {error && <p className="mb-4 text-sm text-destructive">{error.message}</p>}
      {/* Remontée vers l'épisode — le niveau étant facultatif, ce lien n'existe que sur un
          projet qui l'a activé et une séquence qui y est rattachée. */}
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
            {/* Le montage se met à jour à chaque publication : il est en tête, pas en annexe. */}
            <TimelineCard projectId={projectId} sequenceId={sequenceId} />
            <SequenceShotGrid shots={data.shots} />
            <SequenceAssets assets={data.assets} />
          </div>
        )
      )}
    </EntityWorkPage>
  );
}

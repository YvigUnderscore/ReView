// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Fragment } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Clapperboard } from 'lucide-react';
import { api } from '../../lib/apiClient';
import { qk } from '../lib/query';
import { entitySlug, parseIdParam } from '../lib/slug';
import PageShell from '../components/PageShell';
import EmptyState from '../components/ui/empty-state';
import { SkeletonRows } from '../components/ui/skeleton';
import EntityCard, { EntityContainer } from '../components/EntityCard';
import EntityThumb from '../components/entity/EntityThumb';
import PipelineStatusBadge from '../components/shotgrid/PipelineStatusBadge';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '../components/ui/breadcrumb';
import { shotsOfSequence, useEpisodeQuery, useEpisodeSettings } from '../lib/episodesApi';
import type { EpisodeDetail, EpisodeSequence } from '../types/episode';
import { useT } from '../i18n';

/**
 * La page d'un épisode : ses séquences, et sous chacune ses plans.
 *
 * Le niveau étant facultatif, la page se garde elle-même : sur un projet où il est
 * éteint, le serveur répond 409 et l'écran le dit au lieu d'afficher une coquille vide.
 * Aucune URL devinée ne fait donc apparaître un niveau que le projet n'a pas.
 *
 * Le fil d'Ariane est local (Projets › Projet › Épisode) : la chaîne d'ancêtres partagée
 * (`EntityBreadcrumb`) ne connaît pas encore l'épisode.
 */
export default function EpisodePage() {
  const t = useT();
  const { id } = useParams();
  const episodeId = parseIdParam(id);
  const { data, isLoading, error } = useEpisodeQuery(episodeId);
  const projectId = data?.projectId ?? 0;
  const { data: project } = useQuery({
    queryKey: qk.project(projectId),
    queryFn: () => api.get<{ project: { name: string } }>(`/api/projects/${projectId}`),
    enabled: projectId > 0,
  });
  const settings = useEpisodeSettings(projectId, projectId > 0);
  const projectName = project?.project.name ?? '';

  const breadcrumb = (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink to="/projects">{t('nav.projects')}</BreadcrumbLink>
        </BreadcrumbItem>
        {projectName && (
          <Fragment>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink to={`/projects/${entitySlug(projectName, projectId)}`}>
                {projectName}
              </BreadcrumbLink>
            </BreadcrumbItem>
          </Fragment>
        )}
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage>{data?.code ?? t('episodes.title')}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );

  return (
    <PageShell breadcrumb={breadcrumb}>
      {error && <p className="mb-4 text-sm text-destructive">{error.message}</p>}
      {/* Le niveau vient d'être éteint alors que la page était ouverte : le dire, plutôt
          que de laisser un écran qui ne se rechargera jamais. */}
      {settings.data?.enabled === false && (
        <p className="mb-4 text-sm text-muted-foreground">{t('episodes.disabledHere')}</p>
      )}
      {isLoading ? <SkeletonRows count={4} /> : data && <EpisodeBody episode={data} />}
    </PageShell>
  );
}

/** Corps de la page — séparé pour que la page tienne son budget de lignes. */
function EpisodeBody({ episode }: { episode: EpisodeDetail }) {
  const t = useT();
  return (
    <div>
      <header className="mb-5 flex flex-wrap items-start gap-4">
        {/* Comme les autres fiches : la vignette, ou le nom de l'épisode à sa place. */}
        <div className="h-24 w-40 shrink-0 overflow-hidden rounded-lg border border-border">
          <EntityThumb url={episode.thumbnailUrl} name={episode.code} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-xl font-semibold">{episode.code}</h1>
            <PipelineStatusBadge statusId={episode.pipelineStatusId} scope="sequence" />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {[
              episode.name === episode.code ? null : episode.name,
              t('episode.sequenceCount', { count: episode._count.sequences }),
              t('sequence.shotCount', { count: episode.shotCount }),
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
      </header>

      {episode.description && (
        <p className="mb-5 max-w-3xl whitespace-pre-line text-sm text-muted-foreground">
          {episode.description}
        </p>
      )}

      {episode.sequences.length === 0 ? (
        <EmptyState
          compact
          icon={Clapperboard}
          title={t('episode.noSequence.title')}
          description={t('episode.noSequence.description')}
        />
      ) : (
        <div className="space-y-8">
          {episode.sequences.map((sequence) => (
            <SequenceBlock key={sequence.id} sequence={sequence} shots={episode.shots} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Une séquence de l'épisode et les plans qu'elle porte. */
function SequenceBlock({ sequence, shots }: { sequence: EpisodeSequence; shots: EpisodeDetail['shots'] }) {
  const t = useT();
  const rows = shotsOfSequence(shots, sequence);
  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        <Link to={`/sequences/${sequence.id}`} className="text-sm font-semibold hover:underline">
          {sequence.code}
        </Link>
        <PipelineStatusBadge statusId={sequence.pipelineStatusId} scope="sequence" size="xs" />
        <span className="text-sm text-muted-foreground">
          {t('sequence.shotCount', { count: sequence._count.shots })}
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('episode.noShot')}</p>
      ) : (
        <EntityContainer view="cards">
          {rows.map((shot) => (
            <EntityCard
              key={shot.id}
              view="cards"
              to={`/shots/${shot.id}`}
              title={shot.code}
              subtitle={shot.name === shot.code ? undefined : shot.name}
              thumbnailUrl={shot.thumbnailUrl}
              badge={<PipelineStatusBadge statusId={shot.pipelineStatusId} scope="shot" size="xs" />}
            />
          ))}
        </EntityContainer>
      )}
    </section>
  );
}

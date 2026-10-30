// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Fragment, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/apiClient';
import { qk } from '../lib/query';
import { entitySlug } from '../lib/slug';
import { trackRecent } from '../stores/useRecents';
import { useProjectContext } from '../stores/useProjectContext';
import type { AssetRef, MediaRef, ProjectRef, SequenceRef, ShotRef, Task, Version } from '../types/api';
import { useT, type MessageKey } from '../i18n';

/** Translator passed to the label tables, recomputed at each render. */
type Tr = (key: MessageKey) => string;
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from './ui/breadcrumb';

/**
 * Contextual breadcrumb: resolves the chain of ancestors of an entity via
 * GET /api/context/:entity/:id and renders clickable segments
 * (Projects › Project › Sequence › Shot|Asset › Task › Version › Media [› tail]).
 */

export type BreadcrumbEntity = 'media' | 'version' | 'task' | 'shot' | 'sequence' | 'asset' | 'project';

/** Response of GET /api/context/:entity/:id (10.D3): chain of ancestors. */
interface BreadcrumbContext {
  project: ProjectRef;
  sequence?: SequenceRef | null;
  shot?: ShotRef | null;
  asset?: AssetRef | null;
  task?: Pick<Task, 'id' | 'name' | 'type'> | null;
  version?: Pick<Version, 'id' | 'name'> | null;
  media?: MediaRef | null;
}

interface Segment {
  label: string;
  to: string | null;
}

function toSegments(t: Tr, ctx: BreadcrumbContext, tail?: string): Segment[] {
  const pid = ctx.project.id;
  const pslug = entitySlug(ctx.project.name, pid);
  const segments: Segment[] = [
    { label: t('nav.projects'), to: '/projects' },
    { label: ctx.project.name, to: `/projects/${pslug}` },
  ];
  // The sequence has its own page since C3: the link led to the project's tab, which left it to
  // the reader to find the relevant row in the list.
  if (ctx.sequence) segments.push({ label: ctx.sequence.code, to: `/sequences/${ctx.sequence.id}` });
  if (ctx.shot) segments.push({ label: ctx.shot.code, to: `/shots/${ctx.shot.id}` });
  if (ctx.asset) segments.push({ label: ctx.asset.name, to: `/assets/${ctx.asset.id}` });
  if (ctx.task) segments.push({ label: ctx.task.name, to: `/tasks/${ctx.task.id}` });
  if (ctx.version) segments.push({ label: ctx.version.name, to: ctx.task ? `/tasks/${ctx.task.id}` : null });
  if (ctx.media) segments.push({ label: ctx.media.originalName, to: null });
  if (tail) segments.push({ label: tail, to: null });
  return segments;
}

/** Label of the leaf entity (the one of the page visited) for Recents. */
function leafLabel(entity: BreadcrumbEntity, ctx: BreadcrumbContext): string | null {
  switch (entity) {
    case 'project':
      return ctx.project.name;
    case 'sequence':
      return ctx.sequence?.code ?? null;
    case 'shot':
      return ctx.shot?.code ?? null;
    case 'asset':
      return ctx.asset?.name ?? null;
    case 'task':
      return ctx.task?.name ?? null;
    case 'version':
      return ctx.version?.name ?? null;
    case 'media':
      return ctx.media?.originalName ?? null;
  }
}

export default function EntityBreadcrumb({
  entity,
  id,
  tail,
}: {
  entity: BreadcrumbEntity;
  id: number;
  tail?: string;
}) {
  const t = useT();
  const { pathname, search } = useLocation();
  const { data } = useQuery({
    queryKey: qk.context(entity, id),
    queryFn: () => api.get<{ context: BreadcrumbContext }>(`/api/context/${entity}/${id}`),
    enabled: Number.isFinite(id),
  });
  const ctx = data?.context ?? null;

  // Deliberate side effect: each resolved context feeds "Recents" and the
  // current project of the sidebar (10.A4): the exact URL is stored so as to
  // to return in one click.
  useEffect(() => {
    if (!ctx) return;
    useProjectContext.getState().setProjectId(ctx.project.id);
    const leaf = leafLabel(entity, ctx);
    if (!leaf) return;
    trackRecent({
      key: tail ? `${entity}:${id}:${tail}` : `${entity}:${id}`,
      type: entity,
      label: tail ? `${leaf} · ${tail}` : leaf,
      sublabel: entity === 'project' ? undefined : ctx.project.name,
      to: pathname + search,
    });
  }, [ctx, entity, id, tail, pathname, search]);

  if (!ctx) return null;
  const segments = toSegments(t, ctx, tail);
  const last = segments.length - 1;

  return (
    <Breadcrumb>
      <BreadcrumbList>
        {segments.map((s, i) => (
          <Fragment key={`${s.label}-${i}`}>
            {i > 0 && <BreadcrumbSeparator />}
            <BreadcrumbItem>
              {i === last || !s.to ? (
                <BreadcrumbPage>{s.label}</BreadcrumbPage>
              ) : (
                <BreadcrumbLink to={s.to}>{s.label}</BreadcrumbLink>
              )}
            </BreadcrumbItem>
          </Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

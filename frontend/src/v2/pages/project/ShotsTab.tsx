// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowUpRight, Clapperboard, EyeOff } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { useWatch } from '../../lib/useWatch';
import ViewToggle from '../../components/ViewToggle';
import { useViewMode } from '../../stores/useViewPref';
import EntityCard, { EntityContainer } from '../../components/EntityCard';
import ListSentinel, { ListCount } from '../../components/ListSentinel';
import { useStatusMenu } from '../../lib/useStatusMenu';
import { useOmitMenu } from '../../lib/useOmitMenu';
import CreateEntityButton from '../../components/entity/CreateEntityButton';
import MarkAllSeenButton from '../../components/entity/MarkAllSeenButton';
import EmptyState from '../../components/ui/empty-state';
import ShotBulkBar from './ShotBulkBar';
import ShotDialogs from './ShotDialogs';
import EntityFilters from '../../components/EntityFilters';
import PipelineStatusBadge from '../../components/shotgrid/PipelineStatusBadge';
import { activeCount, applyFilters } from '../../lib/entityFilters';
import { useMultiSelect } from '../../lib/useMultiSelect';
import { bulkDelete } from '../../lib/bulkApi';
import { useShotsQuery } from '../../lib/queries';
import { usePipelineStatuses } from '../../lib/shotgridApi';
import { useDepartments } from '../../lib/departmentsApi';
import { useEntityMenus } from '../../lib/useEntityMenus';
import { entityCardMenu } from './entityCardMenu';
import { sortByCode, type Nomenclature, type Sequence, type Shot } from './projectTypes';
import { useT } from '../../i18n';
import { useSgLinks } from '../../components/shotgrid/useSgLinks';
import SgSyncDot from '../../components/shotgrid/SgSyncDot';
import { useUrlFilters } from '../../lib/useUrlFilters';

/**
 * Shots tab: batch creation, cards grouped by sequence, shared filters (C4).
 *
 * The list had neither search nor filter: on a feature film (two thousand shots) there was no way
 * to find anything in it other than scrolling. The criteria and named presets are the same as on
 * the kanban.
 */
export default function ShotsTab({
  projectId,
  sequences,
  shots,
  canManage,
  reload,
  nomenclature,
}: {
  projectId: number;
  sequences: Sequence[];
  shots: Shot[];
  canManage: boolean;
  reload: () => Promise<void>;
  nomenclature: Nomenclature;
}) {
  const t = useT();
  const navigate = useNavigate();
  const view = useViewMode(`shots:${projectId}`);
  // Notification tracking per shot (32.G, right-click).
  const watch = useWatch();
  const [editing, setEditing] = useState<Shot | null>(null);
  const [deleting, setDeleting] = useState<Shot | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useUrlFilters('shots');
  // Same list as the page (same cache key), consulted here for what it knows about itself: how many
  // shots exist and whether any remain to be loaded. A filter set on a truncated page would answer
  // "no shot" for a shot that exists, so we then load everything.
  const paging = useShotsQuery(projectId, projectId > 0, { all: activeCount(filters) > 0 });
  const { data: statuses = [] } = usePipelineStatuses('shot', projectId);
  // Status by right-click: the most frequent gesture of production no longer has to go through the
  // shot's sheet and then its settings panel.
  const { entry: statusEntry } = useStatusMenu(projectId, 'shot');
  // Omission from the edit: a production decision, also on right-click (simple UI).
  const { entry: omitEntry } = useOmitMenu(projectId);
  const { data: departments = [] } = useDepartments(projectId, projectId > 0);
  // Responsible people and hiding: two card gestures, on right-click.
  const { peopleEntry, hideEntry, dialog: entityDialog } = useEntityMenus(projectId, 'shots');

  // Drawer driven by the URL (?shot=ID): back/forward and link sharing stay consistent (10.A6)

  const sortedSequences = sortByCode(sequences);

  const createBulk = async (rows: Record<string, string>[]) => {
    await api.post('/api/shots/bulk', {
      projectId,
      items: rows.map((r) => ({
        code: r.code,
        name: r.name || r.code,
        sequenceId: r.sequenceId ? Number(r.sequenceId) : null,
      })),
    });
    toast.success(t('shots.created', { count: rows.length }));
    await reload();
  };
  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await api.del(`/api/shots/${deleting.id}`);
      toast.success(t('shots.trashed'));
      setDeleting(null);
      void reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error.generic'));
    }
  };

  /**
   * Same composition as on the sequences: the code makes the title, the name goes beneath.
   * The two screens show the same thing and were read differently: the shot lined up
   * "SH010 · Wide establishing" on one line, while the sequence stacked them. And as on the
   * sequences, the name disappears when it repeats the code: most imports do that.
   */
  const subtitleFor = (shot: Shot): string | undefined =>
    [
      shot.name === shot.code ? null : shot.name,
      t('task.count', { count: shot._count?.tasks ?? 0 }),
      shot.assets?.length ? t('assets.count', { count: shot.assets.length }) : null,
    ]
      .filter(Boolean)
      .join(' · ') || undefined;

  const visible = applyFilters(filters, shots, (shot) => ({
    text: `${shot.code} ${shot.name}`,
    statusId: shot.pipelineStatusId,
    sequenceId: shot.sequenceId,
    departmentIds: shot.departments?.map((d) => d.id),
  }));
  // The selection covers only what is displayed, as on assets: a bulk action must never reach a row
  // that the filter has set aside from view.
  const sel = useMultiSelect(visible.map((s) => s.id));

  const confirmBulkDelete = async () => {
    try {
      const { count } = await bulkDelete('shots', sel.ids);
      toast.success(t('shots.trashedCount', { count }));
      sel.clear();
      setBulkDeleting(false);
      void reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error.generic'));
    }
  };

  const groups = [
    ...sortedSequences.map((s) => ({
      seq: s,
      list: visible.filter((sh) => sh.sequenceId === s.id),
    })),
    { seq: null as Sequence | null, list: visible.filter((sh) => sh.sequenceId === null) },
    // An empty group is of no use when filtering: there is nothing left to file in it.
  ].filter((g) => g.list.length > 0);

  const sgLinks = useSgLinks(projectId);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-muted-foreground">{t('shots.title')}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <EntityFilters
            scope={`shots:${projectId}`}
            value={filters}
            onChange={setFilters}
            statuses={statuses.map((s) => ({ value: String(s.id), label: s.name }))}
            sequences={sortedSequences.map((s) => ({ value: String(s.id), label: s.code }))}
            departments={departments.map((d) => ({ value: String(d.id), label: d.name }))}
            searchPlaceholder={t('shots.searchPlaceholder')}
          />
          {canManage && (
            <CreateEntityButton
              projectId={projectId}
              kind="shot"
              defaults={{
                prefix: nomenclature.shotPrefix,
                step: nomenclature.step,
                padding: nomenclature.padding,
              }}
              sequences={sortedSequences}
              onSubmit={(items) =>
                createBulk(
                  items.map((it) => ({
                    code: it.code,
                    name: it.name,
                    sequenceId: it.sequenceId != null ? String(it.sequenceId) : '',
                  })),
                )
              }
            />
          )}
          <MarkAllSeenButton
            target="SHOT"
            projectId={projectId}
            unseenCount={visible.filter((s) => s.unseen).length}
          />
          <ViewToggle contextKey={`shots:${projectId}`} />
        </div>
      </div>
      {error && <p className="mb-3 text-sm text-destructive">{error}</p>}

      {shots.length === 0 ? (
        <EmptyState
          compact
          icon={Clapperboard}
          title={t('shots.empty.title')}
          description={canManage ? t('shots.empty.hint') : t('shots.empty.description')}
        />
      ) : (
        <ListCount
          loaded={paging.loaded}
          total={paging.total}
          label={t('shots.count', { count: paging.total })}
        />
      )}

      {groups.map((g) => (
        <section key={g.seq?.id ?? 'none'} className="mb-6">
          <h3 className="mb-2 text-xs font-semibold section-label text-muted-foreground">
            {/* The group title leads to the sequence: it is the path one looks for while browsing its
                shots, and it did not exist anywhere from this tab. */}
            {g.seq ? (
              <Link
                to={`/sequences/${g.seq.id}`}
                className="inline-flex items-center gap-1 transition-colors hover:text-primary"
              >
                {g.seq.code} · {g.seq.name}
                <ArrowUpRight size={12} />
              </Link>
            ) : (
              t('shots.noSequence')
            )}
          </h3>
          <EntityContainer view={view}>
            {g.list.map((shot) => {
              // Menu shared by the three tabs (`entityCardMenu`): same order, same vocabulary. The
              // ShotGrid link only appears if the project is linked to it.
              const menu = entityCardMenu({
                t,
                kind: 'shot',
                canManage,
                sgUrl: sgLinks.linkFor('shot', shot.id),
                watch: {
                  watching: watch.isWatching('SHOT', shot.id),
                  onToggle: () => watch.toggle('SHOT', shot.id),
                },
                state: {
                  status: statusEntry(shot, { canEdit: canManage }),
                  people: peopleEntry(
                    { id: shot.id, label: shot.code, assignees: shot.assignees },
                    canManage,
                  ),
                  omit: omitEntry(shot, { canEdit: canManage }),
                  hide: hideEntry({ id: shot.id, label: shot.code }),
                },
                onOpen: () => void navigate(`/shots/${shot.id}`),
                onSettings: () => setEditing(shot),
                onTrash: () => setDeleting(shot),
              });
              return (
                <EntityCard
                  key={shot.id}
                  view={view}
                  to={`/shots/${shot.id}`}
                  title={shot.code}
                  subtitle={subtitleFor(shot)}
                  thumbnailUrl={shot.thumbnailUrl}
                  meta={{
                    description: shot.description,
                    assignees: shot.assignees,
                    awaitingReview: shot.awaitingReview,
                    unseen: shot.unseen,
                    updatedAt: shot.updatedAt,
                    departments: shot.departments,
                  }}
                  badge={
                    <span className="flex items-center gap-1">
                      {/* Cut at mounting: the card says so, otherwise the checkbox ticked by right-click
                          would be the only place where the state exists. */}
                      {shot.omitted && (
                        <span title={t('shots.omitted')} className="text-muted-foreground">
                          <EyeOff size={12} />
                        </span>
                      )}
                      <PipelineStatusBadge statusId={shot.pipelineStatusId} scope="shot" size="xs" />
                      <SgSyncDot projectId={projectId} type="shot" localId={shot.id} canRealign={canManage} />
                    </span>
                  }
                  favorite={{ type: 'SHOT', entityId: shot.id }}
                  selection={
                    canManage
                      ? { selected: sel.isSelected(shot.id), onSelect: (m) => sel.onSelect(shot.id, m) }
                      : undefined
                  }
                  actions={menu.hoverActions}
                  contextEntries={menu.contextEntries}
                  contextActions={menu.contextActions}
                />
              );
            })}
          </EntityContainer>
        </section>
      ))}

      {/* Outside the groups: a filter may leave none on screen, and that is precisely where one must
          be able to scroll further down the list. */}
      <ListSentinel hasMore={paging.hasMore} isLoading={paging.isFetchingMore} onLoadMore={paging.loadMore} />

      {canManage && (
        <ShotBulkBar
          projectId={projectId}
          ids={sel.ids}
          count={sel.count}
          onClear={sel.clear}
          onReload={() => void reload()}
          onDelete={() => setBulkDeleting(true)}
        />
      )}

      {entityDialog}
      <ShotDialogs
        projectId={projectId}
        editing={editing}
        deleting={deleting}
        bulkDeleting={bulkDeleting}
        bulkCount={sel.count}
        onCloseEditing={() => setEditing(null)}
        onCancelDelete={() => setDeleting(null)}
        onCancelBulk={() => setBulkDeleting(false)}
        onConfirmDelete={() => void confirmDelete()}
        onConfirmBulk={() => void confirmBulkDelete()}
        onSaved={() => void reload()}
      />
    </div>
  );
}

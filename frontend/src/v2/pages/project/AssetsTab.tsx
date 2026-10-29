// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Plus, Trash2, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { useWatch } from '../../lib/useWatch';
import { useMultiSelect } from '../../lib/useMultiSelect';
import { bulkDelete } from '../../lib/bulkApi';
import ViewToggle from '../../components/ViewToggle';
import MarkAllSeenButton from '../../components/entity/MarkAllSeenButton';
import { useViewMode } from '../../stores/useViewPref';
import { entityCardMenu } from './entityCardMenu';
import { useAssignMenu } from '../../lib/useAssignMenu';
import { useEntityMenus } from '../../lib/useEntityMenus';
import BulkAssignDialog from '../../components/entity/BulkAssignDialog';
import EntityCard, { EntityContainer } from '../../components/EntityCard';
import ListSentinel, { ListCount } from '../../components/ListSentinel';
import ConfirmDialog from '../../components/ConfirmDialog';
import SelectionBar from '../../components/ui/selection-bar';
import AssetAssignDialog from '../../components/AssetAssignDialog';
import EmptyState from '../../components/ui/empty-state';
import { Button } from '../../components/ui/button';
import AssetCreateDialog from './AssetCreateDialog';
import EntityFilters from '../../components/EntityFilters';
import EntitySettingsDialog from '../../components/entity/EntitySettingsDialog';
import { activeCount, applyFilters } from '../../lib/entityFilters';
import { useAssetsQuery } from '../../lib/queries';
import { useDepartments } from '../../lib/departmentsApi';
import { ASSET_TYPES } from './projectTypes';
import type { AssetListItem } from '../../types/entities';
import type { AssetType } from '../../types/api';
import { useT } from '../../i18n';
import { useSgLinks } from '../../components/shotgrid/useSgLinks';
import SgSyncDot from '../../components/shotgrid/SgSyncDot';
import PipelineStatusBadge from '../../components/shotgrid/PipelineStatusBadge';
import { assetTypeLabel } from '../../lib/entityTypeLabels';
import { useUrlFilters } from '../../lib/useUrlFilters';

/**
 * Reusable Assets tab: creation, cards, assignment, shared filters (C4).
 *
 * The list had neither search nor filter: a thousand assets on a feature film, to scroll through.
 * The criteria and named presets are those of the kanban and of the shots.
 */
export default function AssetsTab({
  projectId,
  assets,
  canManage,
  reload,
}: {
  projectId: number;
  assets: AssetListItem[];
  canManage: boolean;
  reload: () => Promise<void>;
}) {
  const t = useT();
  const view = useViewMode(`assets:${projectId}`);
  const navigate = useNavigate();
  // Notification tracking per asset (32.G, right-click).
  const watch = useWatch();
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<AssetListItem | null>(null);
  const [assigning, setAssigning] = useState<AssetListItem | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkAssigning, setBulkAssigning] = useState(false);
  const [editing, setEditing] = useState<AssetListItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useUrlFilters('assets');
  // Same list as the page (same cache key): it tells how many assets exist and whether any remain
  // to be loaded. Filtering a truncated list would lie about the result, so a criterion set loads
  // all the pages.
  const paging = useAssetsQuery(projectId, projectId > 0, { all: activeCount(filters) > 0 });
  const { data: departments = [] } = useDepartments(projectId, projectId > 0);

  const visible = applyFilters(filters, assets, (a) => ({
    text: a.name,
    type: a.type,
    departmentIds: a.departments?.map((d) => d.id),
  }));
  // The selection covers only what is displayed: a bulk action must never reach rows that the
  // filter has set aside from view.
  const sel = useMultiSelect(visible.map((a) => a.id));
  // Assignment by right-click: giving an asset to someone used to require opening each of its
  // tasks, one by one.
  const { assignEntry } = useAssignMenu(projectId, 'asset');
  const { peopleEntry, hideEntry, dialog: entityDialog } = useEntityMenus(projectId, 'assets');

  const confirmBulkDelete = async () => {
    try {
      const { count } = await bulkDelete('assets', sel.ids);
      toast.success(t('assets.trashedCount', { count }));
      sel.clear();
      setBulkDeleting(false);
      void reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error.generic'));
    }
  };

  const create = async (asset: { name: string; type: AssetType }) => {
    try {
      await api.post('/api/assets', { projectId, ...asset });
      toast.success(t('assets.created', { name: asset.name }));
      setCreating(false);
      void reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error.generic'));
    }
  };
  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await api.del(`/api/assets/${deleting.id}`);
      toast.success(t('assets.trashed'));
      setDeleting(null);
      void reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error.generic'));
    }
  };

  const sgLinks = useSgLinks(projectId);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-muted-foreground">{t('assets.title')}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <EntityFilters
            scope={`assets:${projectId}`}
            value={filters}
            onChange={setFilters}
            departments={departments.map((d) => ({ value: String(d.id), label: d.name }))}
            types={ASSET_TYPES}
            typeLabel={(value) => assetTypeLabel(t, value)}
            searchPlaceholder={t('assets.searchPlaceholder')}
          />
          {canManage && (
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus size={16} /> {t('common.create')}
            </Button>
          )}
          <MarkAllSeenButton
            target="ASSET"
            projectId={projectId}
            unseenCount={visible.filter((a) => a.unseen).length}
          />
          <ViewToggle contextKey={`assets:${projectId}`} />
        </div>
      </div>
      {error && <p className="mb-3 text-sm text-destructive">{error}</p>}

      <AssetCreateDialog
        open={creating}
        onOpenChange={setCreating}
        onSubmit={async (asset) => {
          await create(asset);
        }}
      />
      {assets.length > 0 && (
        <ListCount
          loaded={paging.loaded}
          total={paging.total}
          label={t('assets.count', { count: paging.total })}
        />
      )}
      {assets.length === 0 ? (
        <EmptyState
          compact
          icon={Box}
          title={t('assets.empty.title')}
          description={canManage ? t('assets.emptyHint') : t('assets.empty.description')}
          action={canManage ? t('assets.empty.action') : undefined}
          onAction={() => setCreating(true)}
        />
      ) : (
        <EntityContainer view={view}>
          {visible.map((a) => {
            // Menu shared by the three tabs (`entityCardMenu`): same order, same vocabulary, whatever
            // entries this entity type offers.
            const menu = entityCardMenu({
              t,
              kind: 'asset',
              canManage,
              sgUrl: sgLinks.linkFor('asset', a.id),
              watch: {
                watching: watch.isWatching('ASSET', a.id),
                onToggle: () => watch.toggle('ASSET', a.id),
              },
              state: {
                assign: assignEntry(a, canManage),
                people: peopleEntry({ id: a.id, label: a.name, assignees: a.assignees }, canManage),
                hide: hideEntry({ id: a.id, label: a.name }),
              },
              onOpen: () => void navigate(`/assets/${a.id}`),
              onSettings: () => setEditing(a),
              onLink: () => setAssigning(a),
              onTrash: () => setDeleting(a),
            });
            return (
              <EntityCard
                key={a.id}
                to={`/assets/${a.id}`}
                view={view}
                title={a.name}
                subtitle={a.typeLabel ?? a.type}
                thumbnailUrl={a.thumbnailUrl}
                meta={{
                  description: a.description,
                  assignees: a.assignees,
                  awaitingReview: a.awaitingReview,
                  unseen: a.unseen,
                  updatedAt: a.updatedAt,
                  departments: a.departments,
                }}
                badge={
                  <span className="flex items-center gap-1">
                    <PipelineStatusBadge statusId={a.pipelineStatusId} scope="asset" size="xs" />
                    <SgSyncDot projectId={projectId} type="asset" localId={a.id} canRealign={canManage} />
                  </span>
                }
                selection={
                  canManage
                    ? { selected: sel.isSelected(a.id), onSelect: (m) => sel.onSelect(a.id, m) }
                    : undefined
                }
                favorite={{ type: 'ASSET', entityId: a.id }}
                actions={menu.hoverActions}
                contextEntries={menu.contextEntries}
                contextActions={menu.contextActions}
              />
            );
          })}
        </EntityContainer>
      )}

      {/* Outside the list block: a filter may leave nothing on screen, and that is precisely
          where one must be able to scroll further. */}
      <ListSentinel hasMore={paging.hasMore} isLoading={paging.isFetchingMore} onLoadMore={paging.loadMore} />

      {canManage && (
        <SelectionBar
          count={sel.count}
          label={t('assets.countLabel', { count: sel.count })}
          onClear={sel.clear}
          actions={[
            {
              label: t('assign.menu'),
              icon: <UserPlus size={14} />,
              onClick: () => setBulkAssigning(true),
            },
            {
              // The gesture moves to the trash (`softDelete`): say so, as on the card.
              label: t('common.moveToTrash'),
              icon: <Trash2 size={14} />,
              danger: true,
              onClick: () => setBulkDeleting(true),
            },
          ]}
        />
      )}
      {bulkAssigning && (
        <BulkAssignDialog
          projectId={projectId}
          holder="assets"
          ids={sel.ids}
          onClose={() => setBulkAssigning(false)}
          onDone={() => {
            sel.clear();
            void reload();
          }}
        />
      )}
      {entityDialog}
      <ConfirmDialog
        open={bulkDeleting}
        title={t('assets.deleteMany.title')}
        message={t('assets.deleteMany.message', { count: sel.count })}
        confirmLabel={t('common.moveToTrash')}
        danger
        onConfirm={confirmBulkDelete}
        onCancel={() => setBulkDeleting(false)}
      />
      {editing && (
        <EntitySettingsDialog
          kind="asset"
          id={editing.id}
          projectId={projectId}
          entity={editing}
          thumbnailUrl={editing.thumbnailUrl}
          onClose={() => setEditing(null)}
          onSaved={() => void reload()}
        />
      )}
      {assigning && (
        <AssetAssignDialog
          assetId={assigning.id}
          projectId={projectId}
          assetName={assigning.name}
          onClose={() => setAssigning(null)}
          onSaved={reload}
        />
      )}
      <ConfirmDialog
        open={!!deleting}
        title={t('assets.delete.title')}
        message={t('assets.delete.message', { name: deleting?.name ?? '' })}
        confirmLabel={t('common.moveToTrash')}
        danger
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

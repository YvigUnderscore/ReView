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
import { useViewMode } from '../../stores/useViewPref';
import { entriesOf } from '../../lib/menuSpec';
import { assetCardActions } from './assetCardActions';
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
import { EMPTY_FILTERS, activeCount, applyFilters } from '../../lib/entityFilters';
import { useAssetsQuery } from '../../lib/queries';
import { useDepartments } from '../../lib/departmentsApi';
import { ASSET_TYPES } from './projectTypes';
import type { AssetListItem } from '../../types/entities';
import type { AssetType } from '../../types/api';
import { useT } from '../../i18n';
import { useSgLinks } from '../../components/shotgrid/useSgLinks';
import SgSyncDot from '../../components/shotgrid/SgSyncDot';
import PipelineStatusBadge from '../../components/shotgrid/PipelineStatusBadge';

/**
 * Onglet Assets réutilisables : création, cartes, assignation, filtres partagés (C4).
 *
 * La liste n'avait ni recherche ni filtre — mille assets sur un long-métrage, à faire
 * défiler. Les critères et les présélections nommées sont ceux du kanban et des plans.
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
  // Suivi de notifications par asset (32.G, clic droit).
  const watch = useWatch();
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<AssetListItem | null>(null);
  const [assigning, setAssigning] = useState<AssetListItem | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkAssigning, setBulkAssigning] = useState(false);
  const [editing, setEditing] = useState<AssetListItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  // Même liste que la page (même clé de cache) : on y lit combien d'assets existent et
  // s'il en reste à descendre. Filtrer une liste tronquée mentirait sur le résultat, donc
  // un critère posé fait descendre toutes les pages.
  const paging = useAssetsQuery(projectId, projectId > 0, { all: activeCount(filters) > 0 });
  const { data: departments = [] } = useDepartments(projectId, projectId > 0);

  const visible = applyFilters(filters, assets, (a) => ({
    text: a.name,
    type: a.type,
    departmentIds: a.departments?.map((d) => d.id),
  }));
  // La sélection ne porte que sur ce qui est affiché : une action de masse ne doit jamais
  // atteindre des lignes que le filtre a écartées de la vue.
  const sel = useMultiSelect(visible.map((a) => a.id));
  // Assignation par clic droit : confier un asset demandait d'ouvrir chacune de ses
  // tâches, une par une.
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
            searchPlaceholder={t('assets.searchPlaceholder')}
          />
          {canManage && (
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus size={16} /> {t('common.create')}
            </Button>
          )}
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
            const { manageActions, contextActions } = assetCardActions({
              asset: a,
              t,
              canManage,
              sgUrl: sgLinks.linkFor('asset', a.id),
              watching: watch.isWatching('ASSET', a.id),
              onEdit: () => setEditing(a),
              onLink: () => setAssigning(a),
              onDelete: () => setDeleting(a),
              onOpen: () => void navigate(`/assets/${a.id}`),
              onWatch: () => watch.toggle('ASSET', a.id),
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
                  updatedAt: a.updatedAt,
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
                actions={manageActions}
                contextEntries={entriesOf(
                  assignEntry(a, canManage),
                  peopleEntry({ id: a.id, label: a.name, assignees: a.assignees }, canManage),
                  hideEntry({ id: a.id, label: a.name }),
                )}
                contextActions={contextActions}
              />
            );
          })}
        </EntityContainer>
      )}

      {/* Hors du bloc de liste : un filtre peut ne rien laisser à l'écran, et c'est
          justement là qu'il faut pouvoir descendre la suite. */}
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
              label: t('common.delete'),
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

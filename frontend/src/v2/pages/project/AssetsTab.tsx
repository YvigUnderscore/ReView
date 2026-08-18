// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, BellOff, Box, FolderOpen, Link2, Plus, Trash2, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { useWatch } from '../../lib/useWatch';
import { useMultiSelect } from '../../lib/useMultiSelect';
import { bulkDelete } from '../../lib/bulkApi';
import ViewToggle from '../../components/ViewToggle';
import { useViewMode } from '../../stores/useViewPref';
import EntityCard, { EntityContainer, DeleteIcon, EditIcon } from '../../components/EntityCard';
import type { EntityItemAction } from '../../components/EntityCard';
import ConfirmDialog from '../../components/ConfirmDialog';
import SelectionBar from '../../components/ui/selection-bar';
import AssetAssignDialog from '../../components/AssetAssignDialog';
import EmptyState from '../../components/ui/empty-state';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Select } from '../../components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import EntityFilters from '../../components/EntityFilters';
import EntitySettingsDialog from '../../components/entity/EntitySettingsDialog';
import { EMPTY_FILTERS, applyFilters } from '../../lib/entityFilters';
import { useDepartments } from '../../lib/departmentsApi';
import { ASSET_TYPES, type Asset } from './projectTypes';
import { useT } from '../../i18n';
import { useSgLinks } from '../../components/shotgrid/useSgLinks';
import SgSyncDot from '../../components/shotgrid/SgSyncDot';

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
  assets: Asset[];
  canManage: boolean;
  reload: () => Promise<void>;
}) {
  const t = useT();
  const view = useViewMode(`assets:${projectId}`);
  const navigate = useNavigate();
  // Suivi de notifications par asset (32.G, clic droit).
  const watch = useWatch();
  const [newAsset, setNewAsset] = useState({ name: '', type: 'CHARACTER' });
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Asset | null>(null);
  const [assigning, setAssigning] = useState<Asset | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [editing, setEditing] = useState<Asset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const { data: departments = [] } = useDepartments(projectId, projectId > 0);

  const visible = applyFilters(filters, assets, (a) => ({ text: a.name, type: a.type }));
  // La sélection ne porte que sur ce qui est affiché : une action de masse ne doit jamais
  // atteindre des lignes que le filtre a écartées de la vue.
  const sel = useMultiSelect(visible.map((a) => a.id));

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

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/api/assets', { projectId, ...newAsset });
      toast.success(t('assets.created', { name: newAsset.name }));
      setNewAsset({ name: '', type: 'CHARACTER' });
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

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <form onSubmit={create} className="space-y-3">
            <DialogHeader>
              <DialogTitle>{t('assets.new')}</DialogTitle>
            </DialogHeader>
            <div className="space-y-1">
              <Label>{t('assets.name')}</Label>
              <Input
                autoFocus
                placeholder={t('assets.type.placeholder')}
                value={newAsset.name}
                onChange={(e) => setNewAsset((s) => ({ ...s, name: e.target.value }))}
                required
              />
            </div>
            <div className="space-y-1">
              <Label>{t('assets.type')}</Label>
              <Select
                className="w-full"
                value={newAsset.type}
                onChange={(e) => setNewAsset((s) => ({ ...s, type: e.target.value }))}
              >
                {ASSET_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => setCreating(false)}>
                {t('common.undo')}
              </Button>
              <Button type="submit" size="sm">
                {t('common.create')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
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
            const manageActions: EntityItemAction[] = canManage
              ? [
                  {
                    icon: EditIcon,
                    label: t('entity.settings.open'),
                    onClick: () => setEditing(a),
                  },
                  {
                    icon: <Link2 size={15} />,
                    label: t('assets.assign'),
                    onClick: () => setAssigning(a),
                  },
                  {
                    icon: DeleteIcon,
                    label: t('common.delete'),
                    danger: true,
                    onClick: () => setDeleting(a),
                  },
                ]
              : [];
            return (
              <EntityCard
                key={a.id}
                to={`/assets/${a.id}`}
                view={view}
                title={a.name}
                subtitle={a.typeLabel ?? a.type}
                thumbnailUrl={a.thumbnailUrl}
                badge={<SgSyncDot projectId={projectId} type="asset" localId={a.id} canRealign={canManage} />}
                selection={
                  canManage
                    ? { selected: sel.isSelected(a.id), onSelect: (m) => sel.onSelect(a.id, m) }
                    : undefined
                }
                favorite={{ type: 'ASSET', entityId: a.id }}
                actions={manageActions}
                contextActions={[
                  // Fiche ShotGrid — présente uniquement si le projet est relié.
                  ...(sgLinks.linkFor('asset', a.id)
                    ? [
                        {
                          icon: <ExternalLink size={14} />,
                          label: t('shotgrid.openIn.asset'),
                          onClick: () => window.open(sgLinks.linkFor('asset', a.id)!, '_blank', 'noreferrer'),
                        },
                      ]
                    : []),
                  {
                    icon: <FolderOpen size={14} />,
                    label: t('common.open'),
                    onClick: () => void navigate(`/assets/${a.id}`),
                  },
                  // Suivi (32.G) : notifications sur l'activité de l'asset.
                  {
                    icon: watch.isWatching('ASSET', a.id) ? <BellOff size={14} /> : <Bell size={14} />,
                    label: watch.isWatching('ASSET', a.id) ? t('assets.unwatch') : t('assets.watch'),
                    onClick: () => watch.toggle('ASSET', a.id),
                  },
                  ...manageActions,
                ]}
              />
            );
          })}
        </EntityContainer>
      )}

      {canManage && (
        <SelectionBar
          count={sel.count}
          label={t('assets.countLabel', { count: sel.count })}
          onClear={sel.clear}
          actions={[
            {
              label: t('common.delete'),
              icon: <Trash2 size={14} />,
              danger: true,
              onClick: () => setBulkDeleting(true),
            },
          ]}
        />
      )}
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

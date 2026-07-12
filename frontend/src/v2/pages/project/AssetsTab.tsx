import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, FolderOpen, Link2, Plus, Star, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { useFavorites } from '../../stores/useFavorites';
import { useMultiSelect } from '../../lib/useMultiSelect';
import { bulkDelete } from '../../lib/bulkApi';
import ViewToggle from '../../components/ViewToggle';
import { useViewMode } from '../../stores/useViewPref';
import EntityCard, { EntityContainer, DeleteIcon } from '../../components/EntityCard';
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
import { ASSET_TYPES, type Asset } from './projectTypes';

/** Onglet Assets réutilisables : création, cartes, assignation shots/séquences. */
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
  const view = useViewMode(`assets:${projectId}`);
  const navigate = useNavigate();
  const favs = useFavorites((s) => s.favorites);
  const toggleFav = useFavorites((s) => s.toggle);
  const isFav = (id: number) => favs.some((f) => f.type === 'ASSET' && f.entityId === id);
  const [newAsset, setNewAsset] = useState({ name: '', type: 'CHARACTER' });
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Asset | null>(null);
  const [assigning, setAssigning] = useState<Asset | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sel = useMultiSelect(assets.map((a) => a.id));

  const confirmBulkDelete = async () => {
    try {
      const { count } = await bulkDelete('assets', sel.ids);
      toast.success(`${count} asset(s) déplacé(s) dans la corbeille`);
      sel.clear();
      setBulkDeleting(false);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/api/assets', { projectId, ...newAsset });
      toast.success(`Asset « ${newAsset.name} » créé`);
      setNewAsset({ name: '', type: 'CHARACTER' });
      setCreating(false);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  };
  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await api.del(`/api/assets/${deleting.id}`);
      toast.success('Asset déplacé dans la corbeille');
      setDeleting(null);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-muted-foreground">Assets réutilisables</h2>
        <div className="flex items-center gap-2">
          {canManage && (
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus size={16} /> Créer
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
              <DialogTitle>Nouvel asset</DialogTitle>
            </DialogHeader>
            <div className="space-y-1">
              <Label>Nom de l'asset</Label>
              <Input
                autoFocus
                placeholder="Personnage, décor, prop…"
                value={newAsset.name}
                onChange={(e) => setNewAsset((s) => ({ ...s, name: e.target.value }))}
                required
              />
            </div>
            <div className="space-y-1">
              <Label>Type</Label>
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
                Annuler
              </Button>
              <Button type="submit" size="sm">
                Créer
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {assets.length === 0 ? (
        <EmptyState
          compact
          icon={Box}
          title="Aucun asset"
          description={
            canManage
              ? 'Créez vos assets réutilisables avec « + Créer » (personnages, décors, props…).'
              : 'Les assets du projet apparaîtront ici.'
          }
          action={canManage ? 'Créer un asset' : undefined}
          onAction={() => setCreating(true)}
        />
      ) : (
        <EntityContainer view={view}>
          {assets.map((a) => {
            const favAction: EntityItemAction = {
              icon: (
                <Star
                  size={15}
                  fill={isFav(a.id) ? 'currentColor' : 'none'}
                  className={isFav(a.id) ? 'text-warning' : ''}
                />
              ),
              label: 'Favori',
              onClick: () => toggleFav('ASSET', a.id),
            };
            const manageActions: EntityItemAction[] = canManage
              ? [
                  {
                    icon: <Link2 size={15} />,
                    label: 'Assigner à des shots/séquences',
                    onClick: () => setAssigning(a),
                  },
                  { icon: DeleteIcon, label: 'Supprimer', danger: true, onClick: () => setDeleting(a) },
                ]
              : [];
            return (
              <EntityCard
                key={a.id}
                to={`/assets/${a.id}`}
                view={view}
                title={a.name}
                subtitle={a.type}
                thumbnailUrl={a.thumbnailUrl}
                selection={
                  canManage
                    ? { selected: sel.isSelected(a.id), onSelect: (m) => sel.onSelect(a.id, m) }
                    : undefined
                }
                actions={[favAction, ...manageActions]}
                contextActions={[
                  {
                    icon: <FolderOpen size={14} />,
                    label: 'Ouvrir',
                    onClick: () => navigate(`/assets/${a.id}`),
                  },
                  favAction,
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
          label="asset(s)"
          onClear={sel.clear}
          actions={[
            {
              label: 'Supprimer',
              icon: <Trash2 size={14} />,
              danger: true,
              onClick: () => setBulkDeleting(true),
            },
          ]}
        />
      )}
      <ConfirmDialog
        open={bulkDeleting}
        title="Supprimer les assets ?"
        message={<>{sel.count} asset(s) et leurs versions/médias seront déplacés dans la corbeille.</>}
        confirmLabel="Mettre à la corbeille"
        danger
        onConfirm={confirmBulkDelete}
        onCancel={() => setBulkDeleting(false)}
      />
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
        title="Supprimer l'asset ?"
        message={<>L'asset « {deleting?.name} » et ses versions/médias seront déplacés dans la corbeille.</>}
        confirmLabel="Mettre à la corbeille"
        danger
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

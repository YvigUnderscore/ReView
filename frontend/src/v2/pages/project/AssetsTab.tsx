import { useState } from 'react';
import { Box, Link2, Plus, Star } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { useFavorites } from '../../stores/useFavorites';
import ViewToggle, { useViewMode } from '../../components/ViewToggle';
import EntityCard, { EntityContainer, DeleteIcon } from '../../components/EntityCard';
import ConfirmDialog from '../../components/ConfirmDialog';
import AssetAssignDialog from '../../components/AssetAssignDialog';
import EmptyState from '../../components/ui/empty-state';
import { ASSET_TYPES, type Asset } from './projectTypes';

/** Onglet Assets réutilisables : création, cartes, assignation shots/séquences. */
export default function AssetsTab({ projectId, assets, canManage, reload }: {
  projectId: number; assets: Asset[]; canManage: boolean; reload: () => Promise<void>;
}) {
  const view = useViewMode(`assets:${projectId}`);
  const favs = useFavorites((s) => s.favorites);
  const toggleFav = useFavorites((s) => s.toggle);
  const isFav = (id: number) => favs.some((f) => f.type === 'ASSET' && f.entityId === id);
  const [newAsset, setNewAsset] = useState({ name: '', type: 'CHARACTER' });
  const [deleting, setDeleting] = useState<Asset | null>(null);
  const [assigning, setAssigning] = useState<Asset | null>(null);
  const [error, setError] = useState<string | null>(null);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/api/assets', { projectId, ...newAsset });
      toast.success(`Asset « ${newAsset.name} » créé`);
      setNewAsset({ name: '', type: 'CHARACTER' }); reload();
    }
    catch (err) { setError(err instanceof Error ? err.message : 'Erreur'); }
  };
  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await api.del(`/api/assets/${deleting.id}`);
      toast.success('Asset déplacé dans la corbeille');
      setDeleting(null); reload();
    }
    catch (err) { setError(err instanceof Error ? err.message : 'Erreur'); }
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-muted-foreground">Assets réutilisables</h2>
        <ViewToggle contextKey={`assets:${projectId}`} />
      </div>
      {error && <p className="mb-3 text-sm text-destructive">{error}</p>}
      {canManage && (
        <form onSubmit={create} className="mb-5 flex gap-2 rounded-md border border-border bg-card p-2">
          <input className="flex-1 rounded border border-input bg-background px-2 py-1.5 text-xs" placeholder="Nom de l'asset" value={newAsset.name} onChange={(e) => setNewAsset((s) => ({ ...s, name: e.target.value }))} required />
          <select className="rounded border border-input bg-background px-2 py-1.5 text-xs" value={newAsset.type} onChange={(e) => setNewAsset((s) => ({ ...s, type: e.target.value }))}>
            {ASSET_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <button className="flex items-center gap-1 rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground"><Plus size={14} /> Asset</button>
        </form>
      )}
      {assets.length === 0 ? (
        <EmptyState
          compact
          icon={Box}
          title="Aucun asset"
          description={canManage ? 'Créez vos assets réutilisables ci-dessus (personnages, décors, props…).' : 'Les assets du projet apparaîtront ici.'}
        />
      ) : (
        <EntityContainer view={view}>
          {assets.map((a) => (
            <EntityCard
              key={a.id}
              to={`/assets/${a.id}`}
              view={view}
              title={a.name}
              subtitle={a.type}
              thumbnailUrl={a.thumbnailUrl}
              actions={[
                { icon: <Star size={15} fill={isFav(a.id) ? 'currentColor' : 'none'} className={isFav(a.id) ? 'text-amber-400' : ''} />, label: 'Favori', onClick: () => toggleFav('ASSET', a.id) },
                ...(canManage ? [
                  { icon: <Link2 size={15} />, label: 'Assigner à des shots/séquences', onClick: () => setAssigning(a) },
                  { icon: DeleteIcon, label: 'Supprimer', danger: true, onClick: () => setDeleting(a) },
                ] : []),
              ]}
            />
          ))}
        </EntityContainer>
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

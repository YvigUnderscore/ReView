import { useState } from 'react';
import { Clapperboard, Plus, Star } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { useFavorites } from '../../stores/useFavorites';
import ViewToggle from '../../components/ViewToggle';
import { useViewMode } from '../../stores/useViewPref';
import EntityCard, { EntityContainer, EditIcon, DeleteIcon } from '../../components/EntityCard';
import ConfirmDialog from '../../components/ConfirmDialog';
import MultiRowCreate from '../../components/MultiRowCreate';
import BatchGenerator from '../../components/BatchGenerator';
import EmptyState from '../../components/ui/empty-state';
import ModeSwitch, { type CreateMode } from './ModeSwitch';
import ShotDetailDrawer from './ShotDetailDrawer';
import ShotEditDialog from './ShotEditDialog';
import { sortByCode, type Nomenclature, type Sequence, type Shot } from './projectTypes';

/**
 * Onglet Shots : création (simple / lot / auto), cartes groupées par séquence,
 * détail d'un shot en drawer latéral (10.C1) piloté par l'URL (?shot=ID).
 */
export default function ShotsTab({
  projectId,
  sequences,
  shots,
  canManage,
  reload,
  focusId = null,
  onFocus,
  nomenclature,
}: {
  projectId: number;
  sequences: Sequence[];
  shots: Shot[];
  canManage: boolean;
  reload: () => Promise<void>;
  focusId?: number | null;
  onFocus: (id: number | null) => void;
  nomenclature: Nomenclature;
}) {
  const view = useViewMode(`shots:${projectId}`);
  const favs = useFavorites((s) => s.favorites);
  const toggleFav = useFavorites((s) => s.toggle);
  const isFav = (id: number) => favs.some((f) => f.type === 'SHOT' && f.entityId === id);
  const [newShot, setNewShot] = useState({ name: '', code: '', sequenceId: '' });
  const [mode, setMode] = useState<CreateMode>('simple');
  const [editing, setEditing] = useState<Shot | null>(null);
  const [deleting, setDeleting] = useState<Shot | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Drawer piloté par l'URL (?shot=ID) : back/forward et partage de lien cohérents (10.A6)
  const openShot = focusId != null ? (shots.find((s) => s.id === focusId) ?? null) : null;

  const sortedSequences = sortByCode(sequences);

  const createShot = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/api/shots', {
        projectId,
        name: newShot.name || newShot.code,
        code: newShot.code,
        sequenceId: newShot.sequenceId ? Number(newShot.sequenceId) : null,
      });
      toast.success(`Shot « ${newShot.code} » créé`);
      setNewShot({ name: '', code: '', sequenceId: '' });
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  };
  const createBulk = async (rows: Record<string, string>[]) => {
    await api.post('/api/shots/bulk', {
      projectId,
      items: rows.map((r) => ({
        code: r.code,
        name: r.name || r.code,
        sequenceId: r.sequenceId ? Number(r.sequenceId) : null,
      })),
    });
    toast.success(`${rows.length} shot(s) créé(s)`);
    await reload();
  };
  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await api.del(`/api/shots/${deleting.id}`);
      toast.success('Shot déplacé dans la corbeille');
      setDeleting(null);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  };

  const groups = [
    ...sortedSequences.map((s) => ({
      seq: s as Sequence | null,
      list: shots.filter((sh) => sh.sequenceId === s.id),
    })),
    { seq: null as Sequence | null, list: shots.filter((sh) => sh.sequenceId === null) },
  ].filter((g) => g.list.length > 0 || g.seq);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-muted-foreground">Shots</h2>
        <div className="flex items-center gap-2">
          {canManage && <ModeSwitch mode={mode} setMode={setMode} />}
          <ViewToggle contextKey={`shots:${projectId}`} />
        </div>
      </div>
      {error && <p className="mb-3 text-sm text-destructive">{error}</p>}

      {canManage && mode === 'auto' && (
        <BatchGenerator
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
      {canManage && mode === 'manual' && (
        <MultiRowCreate
          addLabel="Créer les shots"
          fields={[
            {
              key: 'code',
              placeholder: `Code (${nomenclature.shotPrefix}${'0'.repeat(nomenclature.padding)})`,
              className: 'w-28',
            },
            { key: 'name', placeholder: 'Nom (optionnel)', className: 'flex-1' },
            {
              key: 'sequenceId',
              placeholder: 'Séquence',
              className: 'w-44',
              options: [
                { value: '', label: 'Sans séquence' },
                ...sortedSequences.map((sq) => ({ value: String(sq.id), label: `${sq.code} · ${sq.name}` })),
              ],
            },
          ]}
          onSubmit={createBulk}
        />
      )}
      {canManage && mode === 'simple' && (
        <form
          onSubmit={createShot}
          className="mb-5 flex flex-wrap gap-2 rounded-md border border-border bg-card p-2"
        >
          <input
            className="w-24 rounded border border-input bg-background px-2 py-1.5 text-xs"
            placeholder="Code"
            value={newShot.code}
            onChange={(e) => setNewShot((s) => ({ ...s, code: e.target.value }))}
            required
          />
          <input
            className="flex-1 rounded border border-input bg-background px-2 py-1.5 text-xs"
            placeholder="Nom (optionnel)"
            value={newShot.name}
            onChange={(e) => setNewShot((s) => ({ ...s, name: e.target.value }))}
          />
          <select
            className="rounded border border-input bg-background px-2 py-1.5 text-xs"
            value={newShot.sequenceId}
            onChange={(e) => setNewShot((s) => ({ ...s, sequenceId: e.target.value }))}
          >
            <option value="">Sans séquence</option>
            {sortedSequences.map((sq) => (
              <option key={sq.id} value={sq.id}>
                {sq.code} · {sq.name}
              </option>
            ))}
          </select>
          <button className="flex items-center gap-1 rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground">
            <Plus size={14} /> Shot
          </button>
        </form>
      )}

      {shots.length === 0 && (
        <EmptyState
          compact
          icon={Clapperboard}
          title="Aucun shot"
          description={
            canManage
              ? 'Créez vos premiers shots avec le formulaire ci-dessus (mode Simple, Lot ou Auto).'
              : 'Les shots du projet apparaîtront ici.'
          }
        />
      )}

      {groups.map((g) => (
        <section key={g.seq?.id ?? 'none'} className="mb-6">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {g.seq ? `${g.seq.code} · ${g.seq.name}` : 'Sans séquence'}
          </h3>
          <EntityContainer view={view}>
            {g.list.map((shot) => (
              <EntityCard
                key={shot.id}
                view={view}
                onClick={() => onFocus(focusId === shot.id ? null : shot.id)}
                active={focusId === shot.id}
                title={`${shot.code} · ${shot.name}`}
                subtitle={`${shot._count?.tasks ?? 0} tâche(s)${shot.assets?.length ? ` · ${shot.assets.length} asset(s)` : ''}`}
                thumbnailUrl={shot.thumbnailUrl}
                actions={[
                  {
                    icon: (
                      <Star
                        size={15}
                        fill={isFav(shot.id) ? 'currentColor' : 'none'}
                        className={isFav(shot.id) ? 'text-warning' : ''}
                      />
                    ),
                    label: 'Favori',
                    onClick: () => toggleFav('SHOT', shot.id),
                  },
                  ...(canManage
                    ? [
                        { icon: EditIcon, label: 'Modifier', onClick: () => setEditing(shot) },
                        {
                          icon: DeleteIcon,
                          label: 'Supprimer',
                          danger: true,
                          onClick: () => setDeleting(shot),
                        },
                      ]
                    : []),
                ]}
              />
            ))}
          </EntityContainer>
        </section>
      ))}

      {/* Détail du shot ouvert : drawer latéral (remplace l'accordéon inline) */}
      <ShotDetailDrawer
        shot={openShot}
        projectId={projectId}
        canManage={canManage}
        onClose={() => onFocus(null)}
        reload={reload}
      />

      {editing && (
        <ShotEditDialog
          shot={editing}
          sequences={sortedSequences}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}

      <ConfirmDialog
        open={!!deleting}
        title="Supprimer le shot ?"
        message={<>Le shot « {deleting?.code} » et ses tâches/versions seront déplacés dans la corbeille.</>}
        confirmLabel="Mettre à la corbeille"
        danger
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

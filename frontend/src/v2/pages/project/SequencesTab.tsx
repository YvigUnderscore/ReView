import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Film, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import FavoriteButton from '../../components/FavoriteButton';
import ConfirmDialog from '../../components/ConfirmDialog';
import MultiRowCreate from '../../components/MultiRowCreate';
import BatchGenerator from '../../components/BatchGenerator';
import { EditIcon, DeleteIcon } from '../../components/EntityCard';
import EmptyState from '../../components/ui/empty-state';
import { SkeletonRows } from '../../components/ui/skeleton';
import ModeSwitch, { type CreateMode } from './ModeSwitch';
import { sortByCode, type Nomenclature, type Sequence, type SequenceDetailData } from './projectTypes';

/** Onglet Séquences : création (simple / lot / auto), édition inline, détail en accordéon. */
export default function SequencesTab({ projectId, sequences, canManage, reload, focusId = null, onFocus, nomenclature }: {
  projectId: number; sequences: Sequence[]; canManage: boolean; reload: () => Promise<void>;
  focusId?: number | null; onFocus: (id: number | null) => void; nomenclature: Nomenclature;
}) {
  const [newSeq, setNewSeq] = useState({ name: '', code: '' });
  const [mode, setMode] = useState<CreateMode>('simple');
  const [editing, setEditing] = useState<number | null>(null);
  const [editVals, setEditVals] = useState({ code: '', name: '' });
  // Accordéon piloté par l'URL (?seq=ID) : back/forward et partage de lien cohérents (10.A6)
  const open = focusId;
  const [deleting, setDeleting] = useState<Sequence | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sorted = sortByCode(sequences);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/api/sequences', { projectId, code: newSeq.code, name: newSeq.name || newSeq.code });
      toast.success(`Séquence « ${newSeq.code} » créée`);
      setNewSeq({ name: '', code: '' }); reload();
    }
    catch (err) { setError(err instanceof Error ? err.message : 'Erreur'); }
  };
  const createBulk = async (rows: Record<string, string>[]) => {
    await api.post('/api/sequences/bulk', {
      projectId,
      items: rows.map((r) => ({ code: r.code, name: r.name || r.code })),
    });
    toast.success(`${rows.length} séquence(s) créée(s)`);
    await reload();
  };
  const startEdit = (s: Sequence) => { setEditing(s.id); setEditVals({ code: s.code, name: s.name }); };
  const saveEdit = async (id: number) => {
    try { await api.patch(`/api/sequences/${id}`, editVals); toast.success('Séquence modifiée'); setEditing(null); reload(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Erreur'); }
  };
  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await api.del(`/api/sequences/${deleting.id}`);
      toast.success('Séquence déplacée dans la corbeille');
      setDeleting(null); reload();
    }
    catch (err) { setError(err instanceof Error ? err.message : 'Erreur'); }
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-muted-foreground">Séquences</h2>
        {canManage && <ModeSwitch mode={mode} setMode={setMode} />}
      </div>
      {error && <p className="mb-3 text-sm text-destructive">{error}</p>}
      {canManage && mode === 'auto' && (
        <BatchGenerator
          defaults={{ prefix: nomenclature.sequencePrefix, step: nomenclature.step, padding: nomenclature.padding }}
          onSubmit={(items) => createBulk(items.map((it) => ({ code: it.code, name: it.name })))}
        />
      )}
      {canManage && mode === 'manual' && (
        <MultiRowCreate
          addLabel="Créer les séquences"
          fields={[
            { key: 'code', placeholder: `Code (${nomenclature.sequencePrefix}${'0'.repeat(nomenclature.padding)})`, className: 'w-32' },
            { key: 'name', placeholder: 'Nom (optionnel)', className: 'flex-1' },
          ]}
          onSubmit={createBulk}
        />
      )}
      {canManage && mode === 'simple' && (
        <form onSubmit={create} className="mb-5 flex gap-2 rounded-md border border-border bg-card p-2">
          <input className="w-28 rounded border border-input bg-background px-2 py-1.5 text-xs" placeholder="Code" value={newSeq.code} onChange={(e) => setNewSeq((s) => ({ ...s, code: e.target.value }))} required />
          <input className="flex-1 rounded border border-input bg-background px-2 py-1.5 text-xs" placeholder="Nom (optionnel)" value={newSeq.name} onChange={(e) => setNewSeq((s) => ({ ...s, name: e.target.value }))} />
          <button className="flex items-center gap-1 rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground"><Plus size={14} /> Séquence</button>
        </form>
      )}
      {sequences.length === 0 ? (
        <EmptyState
          compact
          icon={Film}
          title="Aucune séquence"
          description={canManage ? 'Créez vos séquences ci-dessus — elles regroupent les shots (SQ010, SQ020…).' : 'Les séquences du projet apparaîtront ici.'}
        />
      ) : (
        <div className="space-y-1.5">
          {sorted.map((s) => (
            <div key={s.id} className="rounded-md border border-border bg-card">
              {editing === s.id ? (
                <div className="flex items-center gap-2 px-3 py-2">
                  <input className="w-28 rounded border border-input bg-background px-2 py-1 text-xs" value={editVals.code} onChange={(e) => setEditVals((v) => ({ ...v, code: e.target.value }))} />
                  <input className="flex-1 rounded border border-input bg-background px-2 py-1 text-xs" value={editVals.name} onChange={(e) => setEditVals((v) => ({ ...v, name: e.target.value }))} />
                  <button onClick={() => saveEdit(s.id)} className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground">Enregistrer</button>
                  <button onClick={() => setEditing(null)} className="rounded border border-border px-2 py-1 text-xs">Annuler</button>
                </div>
              ) : (
                <div className="group flex items-center justify-between px-3 py-2">
                  <button onClick={() => onFocus(open === s.id ? null : s.id)} className="text-left text-sm">
                    <span className="font-medium">{s.code}</span> · {s.name}
                  </button>
                  <div className="flex items-center gap-1">
                    <FavoriteButton type="SEQUENCE" entityId={s.id} />
                    {canManage && (
                      <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        <button onClick={() => startEdit(s)} title="Modifier" className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary">{EditIcon}</button>
                        <button onClick={() => setDeleting(s)} title="Supprimer" className="flex h-7 w-7 items-center justify-center rounded-md text-destructive hover:bg-secondary">{DeleteIcon}</button>
                      </div>
                    )}
                  </div>
                </div>
              )}
              {open === s.id && <SequenceDetail sequenceId={s.id} />}
            </div>
          ))}
        </div>
      )}
      <ConfirmDialog
        open={!!deleting}
        title="Supprimer la séquence ?"
        message={<>La séquence « {deleting?.code} » et ses shots seront déplacés dans la corbeille.</>}
        confirmLabel="Mettre à la corbeille"
        danger
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

// Détail d'une séquence : shots + assets assignés (chargé à l'ouverture)
function SequenceDetail({ sequenceId }: { sequenceId: number }) {
  const { data: seqData } = useQuery({
    queryKey: qk.sequence(sequenceId),
    queryFn: () => api.get<{ sequence: SequenceDetailData }>(`/api/sequences/${sequenceId}`),
  });
  const data = seqData?.sequence ?? null;

  if (!data) return <div className="border-t border-border px-3 py-2"><SkeletonRows count={2} /></div>;
  return (
    <div className="space-y-3 border-t border-border px-3 py-3">
      <div>
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Shots ({data.shots.length})</div>
        {data.shots.length === 0 ? (
          <p className="text-xs text-muted-foreground">Aucun shot.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {data.shots.map((sh) => (
              <span key={sh.id} className="rounded border border-border bg-background px-2 py-0.5 text-xs">
                {sh.code} <span className="text-muted-foreground">· {sh.name}</span>
                {sh.assets.length > 0 && <span className="ml-1 text-[10px] text-primary">{sh.assets.length} asset(s)</span>}
              </span>
            ))}
          </div>
        )}
      </div>
      <div>
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Assets de la séquence ({data.assets.length})</div>
        {data.assets.length === 0 ? (
          <p className="text-xs text-muted-foreground">Aucun asset assigné.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {data.assets.map((a) => (
              <Link key={a.id} to={`/assets/${a.id}`} className="rounded border border-border bg-background px-2 py-0.5 text-xs hover:border-primary">
                {a.name} <span className="text-muted-foreground">· {a.type}</span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

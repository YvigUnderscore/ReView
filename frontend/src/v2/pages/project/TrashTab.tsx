import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import ConfirmDialog from '../../components/ConfirmDialog';
import EmptyState from '../../components/ui/empty-state';
import { SkeletonRows } from '../../components/ui/skeleton';
import type { AssetRef, MediaRef, SequenceRef, ShotRef, Version } from '../../types/api';

/** GET /api/projects/:id/trash — éléments supprimés restaurables. */
interface TrashData {
  sequences: SequenceRef[];
  shots: ShotRef[];
  assets: AssetRef[];
  versions: Pick<Version, 'id' | 'name'>[];
  media: MediaRef[];
}

interface TrashItem { id: number; label: string; endpoint: string }

// Hissé hors du render (règle react-hooks/static-components)
function TrashSection({ title, items, onRestore, onPurge }: {
  title: string; items: TrashItem[];
  onRestore: (endpoint: string) => void; onPurge: (item: TrashItem) => void;
}) {
  if (items.length === 0) return null;
  return (
    <section className="mb-5">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      <div className="space-y-1.5">
        {items.map((it) => (
          <div key={it.endpoint} className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-sm">
            <span>{it.label}</span>
            <div className="flex gap-2">
              <button onClick={() => onRestore(it.endpoint)} className="rounded border border-border px-2 py-1 text-xs hover:bg-secondary/60">Restaurer</button>
              <button onClick={() => onPurge(it)} className="rounded px-2 py-1 text-xs text-destructive hover:bg-secondary/60">Supprimer définitivement</button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Onglet Corbeille du projet : restauration / purge par type d'entité. */
export default function TrashTab({ projectId, reload }: { projectId: number; reload: () => Promise<void> }) {
  const qc = useQueryClient();
  const { data, error: loadError } = useQuery({
    queryKey: qk.projectTrash(projectId),
    queryFn: () => api.get<TrashData>(`/api/projects/${projectId}/trash`),
  });
  const [error, setError] = useState<string | null>(null);
  const [purge, setPurge] = useState<TrashItem | null>(null);
  const invalidate = () => qc.invalidateQueries({ queryKey: qk.projectTrash(projectId) });

  const restore = async (endpoint: string) => {
    try { await api.post(`${endpoint}/restore`); toast.success('Élément restauré'); invalidate(); reload(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Erreur'); }
  };
  const confirmPurge = async () => {
    if (!purge) return;
    try { await api.del(`${purge.endpoint}/purge`); toast.success('Supprimé définitivement'); setPurge(null); invalidate(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Erreur'); }
  };

  if (error ?? loadError) return <p className="text-sm text-destructive">{error ?? loadError?.message}</p>;
  if (!data) return <SkeletonRows count={4} />;

  const isEmpty = !data.sequences.length && !data.shots.length && !data.assets.length && !data.versions.length && !data.media.length;

  return (
    <div>
      <h2 className="mb-4 text-sm font-semibold text-muted-foreground">Corbeille du projet</h2>
      {isEmpty && <EmptyState compact icon={Trash2} title="La corbeille est vide" description="Les éléments supprimés du projet arrivent ici et restent restaurables." />}
      <TrashSection title="Séquences" items={data.sequences.map((s) => ({ id: s.id, label: `${s.code} · ${s.name}`, endpoint: `/api/sequences/${s.id}` }))} onRestore={restore} onPurge={setPurge} />
      <TrashSection title="Shots" items={data.shots.map((s) => ({ id: s.id, label: `${s.code} · ${s.name}`, endpoint: `/api/shots/${s.id}` }))} onRestore={restore} onPurge={setPurge} />
      <TrashSection title="Assets" items={data.assets.map((a) => ({ id: a.id, label: `${a.name} (${a.type})`, endpoint: `/api/assets/${a.id}` }))} onRestore={restore} onPurge={setPurge} />
      <TrashSection title="Versions" items={data.versions.map((v) => ({ id: v.id, label: v.name, endpoint: `/api/versions/${v.id}` }))} onRestore={restore} onPurge={setPurge} />
      <TrashSection title="Médias" items={data.media.map((m) => ({ id: m.id, label: `${m.originalName} (${m.kind})`, endpoint: `/api/media/${m.id}` }))} onRestore={restore} onPurge={setPurge} />
      <ConfirmDialog
        open={!!purge}
        title="Supprimer définitivement ?"
        message={<>« {purge?.label} » sera supprimé de la base et du stockage. Cette action est irréversible.</>}
        confirmLabel="Supprimer définitivement"
        danger
        onConfirm={confirmPurge}
        onCancel={() => setPurge(null)}
      />
    </div>
  );
}

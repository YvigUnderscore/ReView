import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import ConfirmDialog from '../../components/ConfirmDialog';
import { Button } from '../../components/ui/button';
import { SkeletonRows } from '../../components/ui/skeleton';
import type { TrashProject } from './adminShared';

export default function TrashTab() {
  const qc = useQueryClient();
  const { data: trash, isLoading } = useQuery({
    queryKey: qk.admin('trash'),
    queryFn: () => api.get<{ projects: TrashProject[] }>('/api/admin/trash').then((d) => d.projects),
  });
  const [purge, setPurge] = useState<TrashProject | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: qk.admin('trash') });
  const restore = async (id: number) => {
    try {
      await api.post(`/api/projects/${id}/restore`);
      toast.success('Projet restauré');
      invalidate();
      qc.invalidateQueries({ queryKey: qk.projects });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Restauration impossible');
    }
  };
  const confirmPurge = async () => {
    if (!purge) return;
    try {
      await api.del(`/api/projects/${purge.id}/purge`);
      toast.success('Projet supprimé définitivement');
      setPurge(null);
      invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Suppression impossible');
    }
  };

  if (isLoading) return <SkeletonRows count={3} />;
  if (!trash || trash.length === 0)
    return <p className="text-sm text-muted-foreground">Aucun projet en corbeille.</p>;
  return (
    <div className="space-y-1.5">
      {trash.map((p) => (
        <div
          key={p.id}
          className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-sm"
        >
          <span>
            {p.name}{' '}
            <span className="text-xs text-muted-foreground">
              · supprimé le {new Date(p.deletedAt).toLocaleDateString()}
            </span>
          </span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => restore(p.id)}>
              Restaurer
            </Button>
            <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setPurge(p)}>
              Supprimer définitivement
            </Button>
          </div>
        </div>
      ))}
      <ConfirmDialog
        open={!!purge}
        title="Supprimer définitivement le projet ?"
        message={
          <>« {purge?.name} » et tous ses médias seront supprimés de la base et du stockage. Irréversible.</>
        }
        confirmLabel="Supprimer définitivement"
        danger
        onConfirm={confirmPurge}
        onCancel={() => setPurge(null)}
      />
    </div>
  );
}

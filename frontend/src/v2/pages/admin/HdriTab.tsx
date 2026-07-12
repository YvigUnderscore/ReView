import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Sun, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { Button } from '../../components/ui/button';
import { SkeletonRows } from '../../components/ui/skeleton';
import { Panel } from './AdminPrimitives';

interface HdriItem {
  id: string;
  name: string;
  format: 'hdr' | 'exr';
  url: string;
  createdAt: string;
}

/**
 * Bibliothèque HDRI (Phase 15 V4) : upload présigné MinIO (.hdr/.exr) + liste + suppression.
 * Ces environnements seront proposés à l'éclairage du viewer 3D Three.js.
 */
export default function HdriTab() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const { data } = useQuery({
    queryKey: qk.admin('hdris'),
    queryFn: () => api.get<{ hdris: HdriItem[] }>('/api/studio/hdris').then((d) => d.hdris),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: qk.admin('hdris') });

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext !== 'hdr' && ext !== 'exr') {
      toast.error('Format non supporté (utilisez .hdr ou .exr)');
      return;
    }
    setBusy(true);
    try {
      const { storageKey, uploadUrl } = await api.post<{ storageKey: string; uploadUrl: string }>(
        '/api/studio/hdris/presign',
        { format: ext },
      );
      const put = await fetch(uploadUrl, { method: 'PUT', body: file });
      if (!put.ok) throw new Error("Échec de l'upload MinIO");
      await api.post('/api/studio/hdris', {
        name: file.name.replace(/\.(hdr|exr)$/i, ''),
        storageKey,
        format: ext,
      });
      toast.success('HDRI ajouté');
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload impossible');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string, name: string) => {
    try {
      await api.del(`/api/studio/hdris/${id}`);
      toast.success(`« ${name} » supprimé`);
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Suppression impossible');
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <p className="text-sm text-muted-foreground">
        Environnements HDRI (.hdr / .exr) utilisés pour l'éclairage image-based du viewer 3D. Uploadez vos
        cartes d'environnement ; elles seront proposées dans les réglages d'éclairage de la review 3D.
      </p>

      <Panel title="Ajouter un HDRI">
        <input ref={fileRef} type="file" accept=".hdr,.exr" onChange={onFile} className="hidden" />
        <Button onClick={() => fileRef.current?.click()} disabled={busy}>
          <Upload size={15} /> {busy ? 'Envoi…' : 'Choisir un fichier .hdr / .exr'}
        </Button>
      </Panel>

      <Panel title="Bibliothèque">
        {data === undefined ? (
          <SkeletonRows count={3} />
        ) : data.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucun HDRI. Ajoutez-en un ci-dessus.</p>
        ) : (
          <div className="space-y-1.5">
            {data.map((h) => (
              <div
                key={h.id}
                className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2"
              >
                <Sun size={16} className="shrink-0 text-warning" />
                <span className="min-w-0 flex-1 truncate text-sm">{h.name}</span>
                <span className="rounded bg-secondary/60 px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                  {h.format}
                </span>
                <Button
                  size="icon"
                  variant="ghost"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => remove(h.id, h.name)}
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

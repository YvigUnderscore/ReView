import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Columns2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import type { VersionDetail, VersionListItem } from '../../types/api';
import { findCompareVideo } from './reviewTypes';

/**
 * Sélecteur de comparaison A/B (backlog P2 10.G) : choisit une autre version de la
 * même tâche/asset et ouvre son premier média vidéo en pane synchronisé. Rendu
 * uniquement s'il existe au moins une autre version.
 */
export default function VideoCompareSelect({
  versionId,
  mediaId,
  compareId,
  onCompareChange,
}: {
  versionId: number;
  mediaId: number;
  compareId: number | null;
  onCompareChange: (mediaId: number | null) => void;
}) {
  const qc = useQueryClient();
  const [selVid, setSelVid] = useState<number | ''>('');
  // Valeur dérivée : une fermeture externe (pane) ramène le sélecteur à « Comparer… ».
  const shown = compareId === null ? '' : selVid;

  // Mêmes queries que VersionNavigator (cache partagé) : version courante → liste parente.
  const versionQ = useQuery({
    queryKey: qk.version(versionId),
    queryFn: () => api.get<{ version: VersionDetail }>(`/api/versions/${versionId}`).then((d) => d.version),
  });
  const version = versionQ.data ?? null;
  const parent = version
    ? version.taskId
      ? `taskId=${version.taskId}`
      : version.assetId
        ? `assetId=${version.assetId}`
        : null
    : null;
  const versionsQ = useQuery({
    queryKey: qk.versions(parent ?? ''),
    queryFn: () =>
      api.get<{ versions: VersionListItem[] }>(`/api/versions?${parent}`).then((d) => d.versions),
    enabled: parent !== null,
  });
  const others = (versionsQ.data ?? []).filter((v) => v.id !== versionId);
  if (others.length === 0) return null;

  const pick = async (vid: number | '') => {
    setSelVid(vid);
    if (vid === '') return onCompareChange(null);
    try {
      const v = await qc.fetchQuery({
        queryKey: qk.version(vid),
        queryFn: () => api.get<{ version: VersionDetail }>(`/api/versions/${vid}`).then((d) => d.version),
      });
      const target = findCompareVideo(v.media, mediaId);
      if (!target) {
        toast.error(`Aucune vidéo à comparer dans la version ${v.name}`);
        setSelVid('');
        return onCompareChange(null);
      }
      onCompareChange(target);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Version inaccessible');
      setSelVid('');
    }
  };

  return (
    <label
      className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground"
      title="Comparer avec une autre version (lecture synchronisée)"
    >
      <Columns2 size={13} />
      <select
        value={shown}
        onChange={(e) => void pick(e.target.value === '' ? '' : Number(e.target.value))}
        className="bg-transparent text-xs font-medium text-foreground focus:outline-none [&>option]:bg-background"
      >
        <option value="">Comparer…</option>
        {others.map((v) => (
          <option key={v.id} value={v.id}>
            vs {v.name}
          </option>
        ))}
      </select>
    </label>
  );
}

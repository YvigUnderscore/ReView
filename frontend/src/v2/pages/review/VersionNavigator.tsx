import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Layers } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { reviewPath } from '../../lib/slug';
import type { VersionDetail, VersionListItem } from '../../types/api';

/**
 * Navigation de l'en-tête review (10.C2) : dropdown des versions de la tâche/asset
 * parente + précédent/suivant entre les médias de la version courante — sans
 * quitter l'écran. Autonome : résout la version du média puis la liste des versions.
 */
export default function VersionNavigator({ versionId, mediaId }: { versionId: number; mediaId: number }) {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const versionQ = useQuery({
    queryKey: qk.version(versionId),
    queryFn: () => api.get<{ version: VersionDetail }>(`/api/versions/${versionId}`).then((d) => d.version),
  });
  const version = versionQ.data ?? null;
  // Query dépendante : liste des versions de la tâche/asset parente
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
  const versions = versionsQ.data ?? [];

  // Bascule vers une autre version : on ouvre son premier média visible.
  const goToVersion = async (vid: number) => {
    if (vid === versionId) return;
    try {
      const v = await qc.fetchQuery({
        queryKey: qk.version(vid),
        queryFn: () => api.get<{ version: VersionDetail }>(`/api/versions/${vid}`).then((d) => d.version),
      });
      const first = v.media[0];
      if (!first) {
        toast.error(`Aucun média visible dans la version ${v.name}`);
        return;
      }
      navigate(reviewPath(first));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Version inaccessible');
    }
  };

  if (!version) return null;
  // La version courante peut être absente de la liste (ex. soft-deleted mais média encore
  // ouvert) : on la préfixe pour que le sélecteur reflète toujours où l'on se trouve.
  const current = { id: version.id, name: version.name, _count: { media: version.media.length } };
  const options = versions.some((v) => v.id === version.id) ? versions : [current, ...versions];
  const idx = version.media.findIndex((m) => m.id === mediaId);
  const prev = idx > 0 ? version.media[idx - 1] : null;
  const next = idx >= 0 && idx < version.media.length - 1 ? version.media[idx + 1] : null;

  return (
    <div className="flex shrink-0 items-center gap-2">
      <label
        className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground"
        title="Changer de version"
      >
        <Layers size={13} />
        <select
          value={version.id}
          onChange={(e) => goToVersion(Number(e.target.value))}
          className="bg-transparent text-xs font-medium text-foreground focus:outline-none [&>option]:bg-background"
        >
          {options.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name} · {v._count.media} média{v._count.media > 1 ? 's' : ''}
            </option>
          ))}
        </select>
      </label>
      {version.media.length > 1 && idx >= 0 && (
        <div className="flex items-center gap-1 rounded-md border border-border px-1 py-0.5 text-xs text-muted-foreground">
          <button
            disabled={!prev}
            onClick={() => prev && navigate(reviewPath(prev))}
            title={prev ? `Média précédent : ${prev.originalName}` : 'Premier média de la version'}
            className="rounded p-1 hover:bg-secondary hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <ChevronLeft size={14} />
          </button>
          <span className="font-mono">
            {idx + 1}/{version.media.length}
          </span>
          <button
            disabled={!next}
            onClick={() => next && navigate(reviewPath(next))}
            title={next ? `Média suivant : ${next.originalName}` : 'Dernier média de la version'}
            className="rounded p-1 hover:bg-secondary hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

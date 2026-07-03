import { useEffect, useState, useRef } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueries, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../../lib/apiClient';
import { qk } from '../lib/query';
import { useAuth } from '../stores/useAuth';
import { useUploadStore } from '../../stores/useUploadStore';
import Shell from '../components/Shell';
import EntityBreadcrumb from '../components/EntityBreadcrumb';
import AssetAssignDialog from '../components/AssetAssignDialog';
import FavoriteButton from '../components/FavoriteButton';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import type { AssetDetail, MediaSummary, VersionDetail, VersionListItem } from '../types/api';

export default function AssetPage() {
  const { id } = useParams();
  const assetId = Number(id);
  const role = useAuth((s) => s.user?.role);
  const canCreate = role !== 'CLIENT';
  const canPublish = role === 'ADMIN' || role === 'SUPERVISOR';
  const canManage = role === 'ADMIN' || role === 'SUPERVISOR';
  const enqueue = useUploadStore((s) => s.enqueue);
  const uploads = useUploadStore((s) => s.uploads);
  const qc = useQueryClient();
  const [assigning, setAssigning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [target, setTarget] = useState<number | null>(null);
  // Versions dont la liste de médias est dépliée (une query par version dépliée)
  const [openIds, setOpenIds] = useState<number[]>([]);

  const versionsQ = useQuery({
    queryKey: qk.versions(`assetId=${assetId}`),
    queryFn: () => api.get<{ versions: VersionListItem[] }>(`/api/versions?assetId=${assetId}`).then((d) => d.versions),
  });
  const versions = versionsQ.data ?? [];
  const assetQ = useQuery({
    queryKey: qk.asset(assetId),
    queryFn: () => api.get<{ asset: AssetDetail }>(`/api/assets/${assetId}`),
  });
  const asset = assetQ.data?.asset ?? null;
  const loadError = versionsQ.error?.message ?? null;

  const mediaQueries = useQueries({
    queries: openIds.map((vid) => ({
      queryKey: qk.version(vid),
      queryFn: () => api.get<{ version: VersionDetail }>(`/api/versions/${vid}`).then((d) => d.version),
    })),
  });
  const mediaByVersion: Record<number, MediaSummary[] | undefined> = {};
  openIds.forEach((vid, i) => { mediaByVersion[vid] = mediaQueries[i]?.data?.media; });

  const invalidateVersions = () => qc.invalidateQueries({ queryKey: qk.versions(`assetId=${assetId}`) });
  useEffect(() => {
    if (uploads.some((u) => u.status === 'done')) {
      qc.invalidateQueries({ queryKey: qk.versions(`assetId=${assetId}`) });
      qc.invalidateQueries({ queryKey: ['version'] });
    }
  }, [uploads, qc, assetId]);

  const createVersion = async () => {
    try { await api.post('/api/versions', { assetId }); toast.success('Version créée'); invalidateVersions(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Erreur'); }
  };
  const publish = async (vid: number) => {
    try { await api.patch(`/api/versions/${vid}`, { status: 'PUBLISHED' }); toast.success('Version publiée'); invalidateVersions(); qc.invalidateQueries({ queryKey: qk.version(vid) }); }
    catch (e) { setError(e instanceof Error ? e.message : 'Erreur'); }
  };
  const openMedia = (versionId: number) => {
    if (openIds.includes(versionId)) qc.invalidateQueries({ queryKey: qk.version(versionId) });
    else setOpenIds((ids) => [...ids, versionId]);
  };
  const publishMedia = async (versionId: number, mediaId: number) => {
    try { await api.post(`/api/media/${mediaId}/publish`); toast.success('Média publié pour l’équipe'); qc.invalidateQueries({ queryKey: qk.version(versionId) }); invalidateVersions(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Erreur'); }
  };
  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && target) enqueue(file, target);
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <Shell breadcrumb={<EntityBreadcrumb entity="asset" id={assetId} />}>
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold">{asset ? asset.name : `Asset #${assetId}`}{asset && <span className="ml-2 text-sm font-normal text-muted-foreground">{asset.type}</span>}</h1>
          <FavoriteButton type="ASSET" entityId={assetId} size={18} />
        </div>
        <div className="flex items-center gap-4 text-sm">
          <Link to={`/assets/${assetId}/board`} className="text-primary hover:underline">Board</Link>
          <Link to="/" className="text-muted-foreground hover:text-foreground">← Projets</Link>
        </div>
      </div>
      {(error ?? loadError) && <p className="mb-4 text-sm text-destructive">{error ?? loadError}</p>}

      {asset && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3 text-sm">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Assigné à&nbsp;:</span>
          {asset.sequences.length === 0 && asset.shots.length === 0 && (
            <span className="text-xs text-muted-foreground">Aucune séquence/shot</span>
          )}
          {asset.sequences.map((s) => (
            <span key={`seq-${s.id}`} className="rounded border border-border bg-background px-2 py-0.5 text-xs">SEQ {s.code} · {s.name}</span>
          ))}
          {asset.shots.map((s) => (
            <span key={`shot-${s.id}`} className="rounded border border-border bg-background px-2 py-0.5 text-xs">SH {s.code} · {s.name}</span>
          ))}
          {canManage && (
            <Button size="sm" variant="outline" className="ml-auto" onClick={() => setAssigning(true)}>Gérer l'assignation</Button>
          )}
        </div>
      )}
      {assigning && asset && (
        <AssetAssignDialog
          assetId={asset.id}
          projectId={asset.projectId}
          assetName={asset.name}
          onClose={() => setAssigning(false)}
          onSaved={() => qc.invalidateQueries({ queryKey: qk.asset(assetId) })}
        />
      )}
      {canCreate && (
        <Button className="mb-4" onClick={createVersion}>+ Nouvelle version</Button>
      )}
      <input ref={fileRef} type="file" className="hidden" onChange={onFile} />

      <div className="space-y-3">
        {versions.map((v) => (
          <div key={v.id} className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-medium">
                {v.name}
                <Badge variant="secondary">{v.status}</Badge>
                {v.published && <Badge variant="success">publié</Badge>}
              </div>
              <div className="flex gap-2">
                {canCreate && <Button size="sm" variant="outline" onClick={() => { setTarget(v.id); fileRef.current?.click(); }}>Uploader un média</Button>}
                {canPublish && !v.published && <Button size="sm" variant="outline" onClick={() => publish(v.id)}>Publier</Button>}
                <Button size="sm" variant="outline" onClick={() => openMedia(v.id)}>Voir médias ({v._count?.media ?? 0})</Button>
              </div>
            </div>
            {mediaByVersion[v.id] && (
              <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {mediaByVersion[v.id]!.map((m) => (
                  <li key={m.id} className="rounded border border-border p-2 text-xs">
                    <Link to={`/review/${m.id}`} className="block hover:text-primary">
                      <div className="truncate">{m.originalName}</div>
                      <div className="text-muted-foreground">
                        {m.kind} · {m.status}
                        {!m.published && <span className="ml-1 rounded bg-amber-500/20 px-1 text-amber-300">Brouillon</span>}
                      </div>
                    </Link>
                    {!m.published && (
                      <Button size="sm" variant="outline" className="mt-1 w-full text-[10px]" onClick={() => publishMedia(v.id, m.id)}>Publier le média</Button>
                    )}
                  </li>
                ))}
                {mediaByVersion[v.id]!.length === 0 && <li className="text-xs text-muted-foreground">Aucun média</li>}
              </ul>
            )}
          </div>
        ))}
        {versions.length === 0 && <p className="text-sm text-muted-foreground">Aucune version.</p>}
      </div>
    </Shell>
  );
}

// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/apiClient';
import { qk } from '../../lib/query';
import { useAssetsQuery } from '../../lib/queries';
import { SkeletonRows } from '../../components/ui/skeleton';
import { ASSET_TYPES, type AssetRef } from '../project/projectTypes';
import { useT } from '../../i18n';
import { assetTypeLabel } from '../../lib/entityTypeLabels';

/**
 * Assets attached to a shot: list, detach, attach an existing one, create + attach.
 *
 * The only place in the application that writes `POST|DELETE /api/shots/:id/assets` — it left the
 * shot drawer with it, otherwise these gestures would have disappeared.
 */
export default function ShotAssets({
  shotId,
  projectId,
  canManage,
  reload,
}: {
  shotId: number;
  projectId: number;
  canManage: boolean;
  /** Refresh the list we came from, when there is one. */
  reload?: () => void;
}) {
  const tr = useT();
  const qc = useQueryClient();
  const shotQ = useQuery({
    queryKey: qk.shot(shotId),
    queryFn: () => api.get<{ shot: { assets: AssetRef[] } }>(`/api/shots/${shotId}`),
  });
  const assets = shotQ.isError ? [] : (shotQ.data?.shot.assets ?? null);
  // Selector: all pages (see AssetAssignDialog), not just the first hundred assets.
  // Gated on `canManage`: the project's full asset list is ONLY used by the "attach an existing
  // one" menu, which is rendered only there. Until now a reader opened the project's full library,
  // page after page, without displaying any of it.
  const allAssets: AssetRef[] =
    useAssetsQuery(projectId, projectId > 0 && canManage, { all: true }).data ?? [];
  const [pick, setPick] = useState('');
  const [creating, setCreating] = useState({ name: '', type: 'CHARACTER' });
  const [showCreate, setShowCreate] = useState(false);

  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: qk.shot(shotId) }),
      qc.invalidateQueries({ queryKey: qk.assets(projectId) }),
    ]);
    reload?.();
  };
  const linkExisting = async () => {
    if (!pick) return;
    await api.post(`/api/shots/${shotId}/assets`, { assetId: Number(pick) });
    toast.success(tr('asset.attached'));
    setPick('');
    await refresh();
  };
  const createAndLink = async () => {
    if (!creating.name.trim()) return;
    await api.post(`/api/shots/${shotId}/assets`, { name: creating.name, type: creating.type });
    toast.success(tr('assets.createdAttached', { name: creating.name }));
    setCreating({ name: '', type: 'CHARACTER' });
    setShowCreate(false);
    await refresh();
  };
  const detach = async (assetId: number) => {
    await api.del(`/api/shots/${shotId}/assets/${assetId}`);
    toast.success(tr('asset.detached'));
    await refresh();
  };

  const linkedIds = new Set((assets ?? []).map((a) => a.id));
  const available = allAssets.filter((a) => !linkedIds.has(a.id));

  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold section-label text-muted-foreground">{tr('shot.assets')}</h3>
      {assets === null ? (
        <SkeletonRows count={1} />
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {assets.length === 0 && <span className="text-xs text-muted-foreground">{tr('asset.none')}</span>}
          {assets.map((a) => (
            <span
              key={a.id}
              className="flex items-center gap-1 rounded border border-border bg-background px-2 py-0.5 text-xs"
            >
              <Link to={`/assets/${a.id}`} className="hover:text-primary">
                {a.name} <span className="text-muted-foreground">· {a.type}</span>
              </Link>
              {canManage && (
                <button
                  onClick={() => detach(a.id)}
                  title={tr('asset.detach')}
                  className="text-muted-foreground hover:text-destructive"
                >
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
      )}
      {canManage && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select
            aria-label={tr('asset.attach')}
            className="rounded border border-input bg-background px-2 py-1 text-xs"
            value={pick}
            onChange={(e) => setPick(e.target.value)}
          >
            <option value="">{tr('asset.attach')}</option>
            {available.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} · {a.type}
              </option>
            ))}
          </select>
          <button
            onClick={linkExisting}
            disabled={!pick}
            className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground disabled:opacity-50"
          >
            {tr('assets.attach')}
          </button>
          <button
            onClick={() => setShowCreate((s) => !s)}
            className="rounded border border-border px-2 py-1 text-xs hover:bg-secondary/60"
          >
            {tr('shot.newAsset')}
          </button>
          {showCreate && (
            <div className="flex items-center gap-1">
              <input
                className="w-40 rounded border border-input bg-background px-2 py-1 text-xs"
                placeholder={tr('assets.name')}
                aria-label={tr('assets.name')}
                value={creating.name}
                onChange={(e) => setCreating((c) => ({ ...c, name: e.target.value }))}
              />
              <select
                aria-label={tr('assets.type')}
                className="rounded border border-input bg-background px-1 py-1 text-xs"
                value={creating.type}
                onChange={(e) => setCreating((c) => ({ ...c, type: e.target.value }))}
              >
                {ASSET_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {assetTypeLabel(tr, t)}
                  </option>
                ))}
              </select>
              <button
                onClick={createAndLink}
                className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground"
              >
                {tr('common.create')}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

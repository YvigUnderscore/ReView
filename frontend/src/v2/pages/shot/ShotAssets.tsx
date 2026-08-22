// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { useAssetsQuery } from '../../lib/queries';
import { SkeletonRows } from '../../components/ui/skeleton';
import { ASSET_TYPES, type AssetRef } from '../project/projectTypes';
import { useT } from '../../i18n';

/**
 * Assets rattachés à un plan : lister, détacher, rattacher un existant, créer + rattacher.
 *
 * Seul endroit de l'application qui écrit `POST|DELETE /api/shots/:id/assets` — il a
 * quitté le tiroir de plan avec lui, sans quoi ces gestes auraient disparu.
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
  /** Rafraîchir la liste d'où l'on vient, quand il y en a une. */
  reload?: () => void;
}) {
  const tr = useT();
  const qc = useQueryClient();
  const shotQ = useQuery({
    queryKey: qk.shot(shotId),
    queryFn: () => api.get<{ shot: { assets: AssetRef[] } }>(`/api/shots/${shotId}`),
  });
  const assets = shotQ.isError ? [] : (shotQ.data?.shot.assets ?? null);
  // Sélecteur : toutes les pages (cf. AssetAssignDialog), pas les cent premiers assets.
  const allAssets: AssetRef[] = useAssetsQuery(projectId, true, { all: true }).data ?? [];
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
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {tr('shot.assets')}
      </h3>
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
                value={creating.name}
                onChange={(e) => setCreating((c) => ({ ...c, name: e.target.value }))}
              />
              <select
                className="rounded border border-input bg-background px-1 py-1 text-xs"
                value={creating.type}
                onChange={(e) => setCreating((c) => ({ ...c, type: e.target.value }))}
              >
                {ASSET_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
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

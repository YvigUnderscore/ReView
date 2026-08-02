// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RotateCcw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { bulkPurge, bulkRestore, type BulkDeleteDomain } from '../../lib/bulkApi';
import { useMultiSelect } from '../../lib/useMultiSelect';
import ConfirmDialog from '../../components/ConfirmDialog';
import EmptyState from '../../components/ui/empty-state';
import { Checkbox } from '../../components/ui/checkbox';
import { SkeletonRows } from '../../components/ui/skeleton';
import type { AssetRef, MediaRef, SequenceRef, ShotRef, Version } from '../../types/api';
import { useT } from '../../i18n';

/** GET /api/projects/:id/trash — éléments supprimés restaurables. */
interface TrashData {
  sequences: SequenceRef[];
  shots: ShotRef[];
  assets: AssetRef[];
  versions: Pick<Version, 'id' | 'name'>[];
  media: MediaRef[];
}

interface TrashItem {
  id: number;
  label: string;
  endpoint: string;
}

// Hissé hors du render (règle react-hooks/static-components). Section avec multi-sélection
// par domaine : restauration / purge groupées ou unitaires.
function TrashSection({
  title,
  domain,
  items,
  onChanged,
}: {
  title: string;
  domain: BulkDeleteDomain;
  items: TrashItem[];
  onChanged: () => void;
}) {
  const t = useT();
  const sel = useMultiSelect(items.map((it) => it.id));
  const [purge, setPurge] = useState<TrashItem | null>(null);
  const [bulkPurging, setBulkPurging] = useState(false);

  if (items.length === 0) return null;

  const restore = async (endpoint: string) => {
    try {
      await api.post(`${endpoint}/restore`);
      toast.success(t('trash.restored'));
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error.generic'));
    }
  };
  const confirmPurge = async () => {
    if (!purge) return;
    try {
      await api.del(`${purge.endpoint}/purge`);
      toast.success(t('trash.deleted'));
      setPurge(null);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error.generic'));
    }
  };
  const bulkRestoreSel = async () => {
    try {
      const { count } = await bulkRestore(domain, sel.ids);
      toast.success(`${count} élément(s) restauré(s)`);
      sel.clear();
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error.generic'));
    }
  };
  const confirmBulkPurge = async () => {
    try {
      const { count } = await bulkPurge(domain, sel.ids);
      toast.success(`${count} élément(s) supprimé(s) définitivement`);
      sel.clear();
      setBulkPurging(false);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error.generic'));
    }
  };

  return (
    <section className="mb-5">
      <div className="mb-2 flex items-center gap-2">
        <div
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            sel.toggleAll();
          }}
        >
          <Checkbox
            checked={sel.allSelected}
            onCheckedChange={() => {}}
            tabIndex={-1}
            aria-label={t('common.selectAll')}
          />
        </div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
        {sel.count > 0 && (
          <div className="ml-auto flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">{sel.count} sélectionné(s)</span>
            <button
              onClick={bulkRestoreSel}
              className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs hover:bg-secondary/60"
            >
              <RotateCcw size={12} /> {t('common.restore')}
            </button>
            <button
              onClick={() => setBulkPurging(true)}
              className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-destructive hover:bg-secondary/60"
            >
              <Trash2 size={12} /> {t('common.delete')}
            </button>
          </div>
        )}
      </div>
      <div className="space-y-1.5">
        {items.map((it) => (
          <div
            key={it.endpoint}
            className="flex items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2 text-sm"
          >
            <div className="flex min-w-0 items-center gap-2.5">
              <div
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  sel.onSelect(it.id, { shiftKey: e.shiftKey, metaKey: e.metaKey, ctrlKey: e.ctrlKey });
                }}
              >
                <Checkbox
                  checked={sel.isSelected(it.id)}
                  onCheckedChange={() => {}}
                  tabIndex={-1}
                  aria-label={t('common.select')}
                />
              </div>
              <span className="truncate">{it.label}</span>
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                onClick={() => restore(it.endpoint)}
                className="rounded border border-border px-2 py-1 text-xs hover:bg-secondary/60"
              >
                {t('common.restore')}
              </button>
              <button
                onClick={() => setPurge(it)}
                className="rounded px-2 py-1 text-xs text-destructive hover:bg-secondary/60"
              >
                {t('common.deletePermanently')}
              </button>
            </div>
          </div>
        ))}
      </div>
      <ConfirmDialog
        open={bulkPurging}
        title={t('trash.delete.title')}
        message={<>{sel.count} élément(s) seront supprimés de la base et du stockage. Irréversible.</>}
        confirmLabel={t('common.deletePermanently')}
        danger
        onConfirm={confirmBulkPurge}
        onCancel={() => setBulkPurging(false)}
      />
      <ConfirmDialog
        open={!!purge}
        title={t('trash.delete.title')}
        message={
          <>« {purge?.label} » sera supprimé de la base et du stockage. Cette action est irréversible.</>
        }
        confirmLabel={t('common.deletePermanently')}
        danger
        onConfirm={confirmPurge}
        onCancel={() => setPurge(null)}
      />
    </section>
  );
}

/** Onglet Corbeille du projet : restauration / purge par type d'entité, multi-sélection incluse. */
export default function TrashTab({ projectId, reload }: { projectId: number; reload: () => Promise<void> }) {
  const t = useT();
  const qc = useQueryClient();
  const { data, error } = useQuery({
    queryKey: qk.projectTrash(projectId),
    queryFn: () => api.get<TrashData>(`/api/projects/${projectId}/trash`),
  });
  const onChanged = () => {
    qc.invalidateQueries({ queryKey: qk.projectTrash(projectId) });
    reload();
  };

  if (error) return <p className="text-sm text-destructive">{error.message}</p>;
  if (!data) return <SkeletonRows count={4} />;

  const isEmpty =
    !data.sequences.length &&
    !data.shots.length &&
    !data.assets.length &&
    !data.versions.length &&
    !data.media.length;

  return (
    <div>
      <h2 className="mb-4 text-sm font-semibold text-muted-foreground">{t('trash.project.title')}</h2>
      {isEmpty && (
        <EmptyState
          compact
          icon={Trash2}
          title={t('trash.empty.title')}
          description={t('trash.empty.description')}
        />
      )}
      <TrashSection
        title={t('sequences.title')}
        domain="sequences"
        items={data.sequences.map((s) => ({
          id: s.id,
          label: `${s.code} · ${s.name}`,
          endpoint: `/api/sequences/${s.id}`,
        }))}
        onChanged={onChanged}
      />
      <TrashSection
        title={t('shots.title')}
        domain="shots"
        items={data.shots.map((s) => ({
          id: s.id,
          label: `${s.code} · ${s.name}`,
          endpoint: `/api/shots/${s.id}`,
        }))}
        onChanged={onChanged}
      />
      <TrashSection
        title="Assets"
        domain="assets"
        items={data.assets.map((a) => ({
          id: a.id,
          label: `${a.name} (${a.type})`,
          endpoint: `/api/assets/${a.id}`,
        }))}
        onChanged={onChanged}
      />
      <TrashSection
        title="Versions"
        domain="versions"
        items={data.versions.map((v) => ({ id: v.id, label: v.name, endpoint: `/api/versions/${v.id}` }))}
        onChanged={onChanged}
      />
      <TrashSection
        title={t('trash.group.media')}
        domain="media"
        items={data.media.map((m) => ({
          id: m.id,
          label: `${m.originalName} (${m.kind})`,
          endpoint: `/api/media/${m.id}`,
        }))}
        onChanged={onChanged}
      />
    </div>
  );
}

// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RotateCcw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { bulkPurge, bulkRestore, type BulkDeleteDomain } from '../../lib/bulkApi';
import ConfirmDialog from '../../components/ConfirmDialog';
import EmptyState from '../../components/ui/empty-state';
import { Checkbox } from '../../components/ui/checkbox';
import { SkeletonRows } from '../../components/ui/skeleton';
import TrashSection, { type TrashItem } from './TrashSection';
import {
  countAll,
  countSelected,
  idsOf,
  selectedDomains,
  toggle,
  toggleDomain,
  toggleEverything,
  type TrashInventory,
  type TrashSelection,
} from './trashSelection';
import type { AssetRef, EpisodeRef, MediaRef, SequenceRef, ShotRef, Version } from '../../types/api';
import { useT } from '../../i18n';

/** GET /api/projects/:id/trash — éléments supprimés restaurables. */
interface TrashData {
  /** Niveau Épisode (facultatif) : liste vide — donc section absente — sans lui. */
  episodes: EpisodeRef[];
  sequences: SequenceRef[];
  shots: ShotRef[];
  assets: AssetRef[];
  versions: Pick<Version, 'id' | 'name'>[];
  media: MediaRef[];
}

/**
 * Onglet Corbeille du projet.
 *
 * La sélection est **globale**, pas par section : cocher « tout » dans les plans ne touchait
 * ni les séquences, ni les assets, ni les versions, si bien que vider une corbeille de fin
 * de projet demandait six passes — et qu'il fallait penser aux six.
 */
export default function TrashTab({ projectId, reload }: { projectId: number; reload: () => Promise<void> }) {
  const t = useT();
  const qc = useQueryClient();
  const [selection, setSelection] = useState<TrashSelection>({});
  const [purging, setPurging] = useState<TrashItem | null>(null);
  const [bulkPurging, setBulkPurging] = useState(false);

  const { data, error } = useQuery({
    queryKey: qk.projectTrash(projectId),
    queryFn: () => api.get<TrashData>(`/api/projects/${projectId}/trash`),
  });

  const onChanged = () => {
    setSelection({});
    void qc.invalidateQueries({ queryKey: qk.projectTrash(projectId) });
    void reload();
  };
  const fail = (err: unknown) => toast.error(err instanceof Error ? err.message : t('common.error.generic'));

  const restoreOne = (endpoint: string) => {
    api
      .post(`${endpoint}/restore`)
      .then(() => {
        toast.success(t('trash.restored'));
        onChanged();
      })
      .catch(fail);
  };
  const purgeOne = () => {
    if (!purging) return;
    api
      .del(`${purging.endpoint}/purge`)
      .then(() => {
        toast.success(t('trash.deleted'));
        setPurging(null);
        onChanged();
      })
      .catch(fail);
  };

  /** Restaure ou purge la sélection, domaine par domaine — ce que les routes attendent. */
  const runBulk = async (action: typeof bulkRestore) => {
    try {
      let total = 0;
      for (const domain of selectedDomains(selection)) {
        const { count } = await action(domain, idsOf(selection, domain));
        total += count;
      }
      return total;
    } catch (err) {
      fail(err);
      return null;
    }
  };

  const restoreSelection = async () => {
    const count = await runBulk(bulkRestore);
    if (count !== null) {
      toast.success(t('trash.restoredCount', { count }));
      onChanged();
    }
  };
  const purgeSelection = async () => {
    const count = await runBulk(bulkPurge);
    setBulkPurging(false);
    if (count !== null) {
      toast.success(t('trash.purged', { count }));
      onChanged();
    }
  };

  if (error) return <p className="text-sm text-destructive">{error.message}</p>;
  if (!data) return <SkeletonRows count={4} />;

  const sections: { title: string; domain: BulkDeleteDomain; items: TrashItem[] }[] = [
    {
      title: t('episodes.title'),
      domain: 'episodes',
      items: data.episodes.map((e) => ({
        id: e.id,
        label: `${e.code} · ${e.name}`,
        endpoint: `/api/episodes/${e.id}`,
      })),
    },
    {
      title: t('sequences.title'),
      domain: 'sequences',
      items: data.sequences.map((s) => ({
        id: s.id,
        label: `${s.code} · ${s.name}`,
        endpoint: `/api/sequences/${s.id}`,
      })),
    },
    {
      title: t('shots.title'),
      domain: 'shots',
      items: data.shots.map((s) => ({
        id: s.id,
        label: `${s.code} · ${s.name}`,
        endpoint: `/api/shots/${s.id}`,
      })),
    },
    {
      title: t('assets.title'),
      domain: 'assets',
      items: data.assets.map((a) => ({
        id: a.id,
        label: `${a.name} (${a.type})`,
        endpoint: `/api/assets/${a.id}`,
      })),
    },
    {
      title: t('trash.group.versions'),
      domain: 'versions',
      items: data.versions.map((v) => ({ id: v.id, label: v.name, endpoint: `/api/versions/${v.id}` })),
    },
    {
      title: t('trash.group.media'),
      domain: 'media',
      items: data.media.map((m) => ({
        id: m.id,
        label: `${m.originalName} (${m.kind})`,
        endpoint: `/api/media/${m.id}`,
      })),
    },
  ];

  const inventory: TrashInventory = Object.fromEntries(
    sections.filter((s) => s.items.length > 0).map((s) => [s.domain, s.items.map((it) => it.id)]),
  );
  const total = countAll(inventory);
  const picked = countSelected(selection);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-muted-foreground">{t('trash.project.title')}</h2>
        {total > 0 && (
          <>
            {/* La case « tout » porte sur la corbeille entière : c'est le geste qui manquait. */}
            <label className="ml-2 flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
              <Checkbox
                checked={picked === total}
                onCheckedChange={() => setSelection(toggleEverything(selection, inventory))}
                aria-label={t('trash.selectEverything')}
              />
              {t('trash.selectEverything')}
            </label>
            {picked > 0 && (
              <span className="ml-auto flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">
                  {t('trash.selectedCount', { count: picked })}
                </span>
                <button
                  onClick={() => void restoreSelection()}
                  className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs hover:bg-secondary/60"
                >
                  <RotateCcw size={12} /> {t('common.restore')}
                </button>
                <button
                  onClick={() => setBulkPurging(true)}
                  className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-destructive hover:bg-secondary/60"
                >
                  <Trash2 size={12} /> {t('common.deletePermanently')}
                </button>
              </span>
            )}
          </>
        )}
      </div>

      {total === 0 && (
        <EmptyState
          compact
          icon={Trash2}
          title={t('trash.empty.title')}
          description={t('trash.empty.description')}
        />
      )}

      {sections.map((section) => (
        <TrashSection
          key={section.domain}
          title={section.title}
          domain={section.domain}
          items={section.items}
          selection={selection}
          onToggle={(domain, id) => setSelection((s) => toggle(s, domain, id))}
          onToggleDomain={(domain, ids) => setSelection((s) => toggleDomain(s, domain, ids))}
          onRestore={restoreOne}
          onPurge={setPurging}
        />
      ))}

      <ConfirmDialog
        open={bulkPurging}
        title={t('trash.delete.title')}
        message={t('trash.deleteMany.message', { count: picked })}
        confirmLabel={t('common.deletePermanently')}
        danger
        onConfirm={() => void purgeSelection()}
        onCancel={() => setBulkPurging(false)}
      />
      <ConfirmDialog
        open={!!purging}
        title={t('trash.delete.title')}
        message={t('trash.delete.message', { name: purging?.label ?? '' })}
        confirmLabel={t('common.deletePermanently')}
        danger
        onConfirm={purgeOne}
        onCancel={() => setPurging(null)}
      />
    </div>
  );
}

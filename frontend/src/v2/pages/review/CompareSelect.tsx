// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Columns2, LayoutGrid } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { Checkbox } from '../../components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover';
import type { VersionDetail, VersionListItem } from '../../types/api';
import { findCompareMedia } from './reviewTypes';
import { MAX_COMPARE } from './useCompareState';
import { useT } from '../../i18n';

/**
 * Sélecteur de comparaison (vidéo **et image**) : coche d'autres versions de la même
 * tâche/asset — 1 version = A/B côte-à-côte/wipe ; 2-3 versions (vidéo, 34.D) = grille
 * 2×2 synchronisée. L'image reste mono-comparaison (coche exclusive). Rendu uniquement
 * s'il existe une autre version.
 */
export default function CompareSelect({
  versionId,
  mediaId,
  kind,
  compareIds,
  onAdd,
  onRemove,
  onSet,
}: {
  versionId: number;
  mediaId: number;
  /** Type du média maître — les médias B doivent être du même type. */
  kind: string;
  compareIds: number[];
  onAdd: (mediaId: number) => void;
  onRemove: (mediaId: number) => void;
  /** Remplacement exclusif (image) — garde la sémantique A/B simple. */
  onSet: (mediaId: number | null) => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  // Version cochée → média B résolu (nécessaire pour décocher et refléter l'état).
  const [vidToMedia, setVidToMedia] = useState<Record<number, number>>({});
  const multi = kind === 'VIDEO';

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

  const checked = (vid: number) => {
    const m = vidToMedia[vid];
    return m != null && compareIds.includes(m);
  };
  const checkedCount = others.filter((v) => checked(v.id)).length;

  const toggle = async (v: VersionListItem) => {
    if (checked(v.id)) {
      if (multi) onRemove(vidToMedia[v.id]!);
      else onSet(null);
      return;
    }
    try {
      const detail = await qc.fetchQuery({
        queryKey: qk.version(v.id),
        queryFn: () => api.get<{ version: VersionDetail }>(`/api/versions/${v.id}`).then((d) => d.version),
      });
      const target = findCompareMedia(detail.media, mediaId, kind);
      if (!target) {
        toast.error(
          t('compare.noMediaToCompare', {
            kind: kind === 'IMAGE' ? t('entity.imageLower') : t('entity.videoLower'),
            version: v.name,
          }),
        );
        return;
      }
      setVidToMedia((m) => ({ ...m, [v.id]: target }));
      if (multi) onAdd(target);
      else onSet(target);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('version.unreachable'));
    }
  };

  const label =
    compareIds.length === 0
      ? 'Comparer…'
      : compareIds.length === 1
        ? `vs ${others.find((v) => checked(v.id))?.name ?? '…'}`
        : t('compare.grid', { count: compareIds.length + 1 });

  return (
    <Popover>
      <PopoverTrigger
        title={multi ? t('compare.otherVersions') : t('compare.otherVersion')}
        className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground hover:bg-secondary"
      >
        {compareIds.length >= 2 ? <LayoutGrid size={13} /> : <Columns2 size={13} />}
        {label}
        <ChevronDown size={12} className="text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent className="w-56 p-1">
        {others.map((v) => {
          const isOn = checked(v.id);
          const disabled = multi && !isOn && checkedCount >= MAX_COMPARE;
          return (
            <button
              key={v.id}
              disabled={disabled}
              onClick={() => void toggle(v)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-secondary disabled:opacity-40"
            >
              <Checkbox checked={isOn} className="pointer-events-none" tabIndex={-1} />
              <span className="truncate">{v.name}</span>
            </button>
          );
        })}
        {multi && (
          <p className="px-2 pb-1 pt-1.5 text-[10px] text-muted-foreground">
            {t('compare.gridHint', { max: MAX_COMPARE + 1 })}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}

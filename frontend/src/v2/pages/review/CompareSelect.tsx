// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Columns2, LayoutGrid } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/apiClient';
import { qk } from '../../lib/query';
import { Checkbox } from '../../components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover';
import type { MediaSummary, VersionDetail, VersionListItem } from '../../types/api';
import { findCompareMedia } from './reviewTypes';
import { MAX_COMPARE } from './useCompareState';
import { useT, type MessageKey } from '../../i18n';

/** Media type name in the "nothing to compare" message — agreed with the master type. */
const KIND_LABEL: Record<string, MessageKey> = {
  VIDEO: 'entity.videoLower',
  IMAGE: 'entity.imageLower',
  MODEL_3D: 'entity.model3dLower',
  SPLAT: 'entity.splatLower',
};

/**
 * Comparison selector (video, image, **3D model and splat**): checks other versions of the
 * same task/asset — 1 version = side-by-side/wipe A/B; 2-3 versions (video, 34.D) = a
 * synchronized 2×2 grid; in 3D/splat, the checked models join the shared scene (linked
 * camera). Images stay single-comparison (exclusive check). Rendered only when another
 * version exists.
 *
 * The resolved media summary is passed along with its identifier: the spatial viewers need
 * it to name the comparison tab, and already have it at hand here.
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
  /** Type of the master media — B media must be of the same type. */
  kind: string;
  compareIds: number[];
  onAdd: (mediaId: number, media?: MediaSummary) => void;
  onRemove: (mediaId: number) => void;
  /** Exclusive replacement (image) — keeps the A/B semantics simple. */
  onSet: (mediaId: number | null, media?: MediaSummary) => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  // Checked version → resolved B media (needed to uncheck and reflect the state).
  const [vidToMedia, setVidToMedia] = useState<Record<number, number>>({});
  // Images stay alone in exclusive A/B: the video grid and the spatial scene accept
  // several versions at once.
  const multi = kind !== 'IMAGE';

  // Same queries as VersionNavigator (shared cache): current version → parent list.
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
      if (multi) onRemove(vidToMedia[v.id]);
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
            kind: t(KIND_LABEL[kind] ?? 'entity.videoLower'),
            version: v.name,
          }),
        );
        return;
      }
      const media = detail.media.find((m) => m.id === target);
      setVidToMedia((m) => ({ ...m, [v.id]: target }));
      if (multi) onAdd(target, media);
      else onSet(target, media);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('version.unreachable'));
    }
  };

  const label =
    compareIds.length === 0
      ? t('compare.pick')
      : compareIds.length === 1
        ? t('compare.vs', { name: others.find((v) => checked(v.id))?.name ?? '…' })
        : t('compare.grid', { count: compareIds.length + 1 });

  // The 2×2 grid is specific to video; in 3D/splat, the checked versions join the
  // shared scene — two different promises, two tooltips.
  const spatial = kind === 'MODEL_3D' || kind === 'SPLAT';
  const title = spatial
    ? t('compare.otherVersionsSpatial')
    : multi
      ? t('compare.otherVersions')
      : t('compare.otherVersion');

  return (
    <Popover>
      <PopoverTrigger
        title={title}
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
          <p className="px-2 pb-1 pt-1.5 text-2xs text-muted-foreground">
            {spatial ? t('compare.sceneHint') : t('compare.gridHint', { max: MAX_COMPARE + 1 })}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}

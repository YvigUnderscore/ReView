// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ChevronLeft,
  ChevronRight,
  Layers,
  Video,
  Image as ImageIcon,
  Box,
  Boxes,
  type LucideIcon,
} from 'lucide-react';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { reviewPath } from '../../lib/slug';
import { useT } from '../../i18n';
import type { MediaKind, VersionDetail } from '../../types/api';

const KIND_ICON: Record<MediaKind, LucideIcon> = {
  VIDEO: Video,
  IMAGE: ImageIcon,
  MODEL_3D: Box,
  SPLAT: Boxes,
};

/**
 * Assets de la version courante — le passage d'un livrable à l'autre à l'intérieur d'une
 * même version. Ce n'est pas une pellicule : les entrées ne sont pas des images d'un film
 * mais des médias distincts (un rendu, un turntable, un modèle, un splat), et chacune se
 * montre par sa vraie vignette, son type et son nom.
 *
 * Réutilise la query `qk.version` (déjà chargée par VersionNavigator) ; masqué quand la
 * version ne porte qu'un seul asset — il n'y a alors rien entre quoi passer.
 */
export default function VersionAssets({ versionId, mediaId }: { versionId: number; mediaId: number }) {
  const t = useT();
  const navigate = useNavigate();
  const versionQ = useQuery({
    queryKey: qk.version(versionId),
    queryFn: () => api.get<{ version: VersionDetail }>(`/api/versions/${versionId}`).then((d) => d.version),
  });
  const media = versionQ.data?.media ?? [];
  const index = media.findIndex((m) => m.id === mediaId);
  if (media.length < 2) return null;

  // Le pas circulaire : depuis le dernier asset, « suivant » revient au premier. Une version
  // en porte rarement plus de trois ou quatre, buter en bout de bande n'apprend rien.
  const step = (delta: number) => {
    const from = index < 0 ? 0 : index;
    const next = media[(from + delta + media.length) % media.length];
    if (next && next.id !== mediaId) void navigate(reviewPath(next));
  };

  return (
    <div className="flex shrink-0 flex-col gap-2 rounded-md border border-border bg-card/60 p-2">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Layers size={13} className="text-primary" />
        <span className="font-medium text-foreground">{t('review.versionAssets')}</span>
        {index >= 0 && (
          <span className="tabular-nums">
            {index + 1} / {media.length}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => step(-1)}
            title={t('review.prevAsset')}
            aria-label={t('review.prevAsset')}
            className="rounded border border-border p-0.5 text-muted-foreground hover:border-primary/60 hover:text-foreground"
          >
            <ChevronLeft size={13} />
          </button>
          <button
            type="button"
            onClick={() => step(1)}
            title={t('review.nextAsset')}
            aria-label={t('review.nextAsset')}
            className="rounded border border-border p-0.5 text-muted-foreground hover:border-primary/60 hover:text-foreground"
          >
            <ChevronRight size={13} />
          </button>
        </div>
      </div>

      <div className="flex items-stretch gap-2 overflow-x-auto pb-0.5">
        {media.map((m, i) => {
          const Icon = KIND_ICON[m.kind] ?? ImageIcon;
          const active = m.id === mediaId;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => !active && navigate(reviewPath(m))}
              title={m.originalName}
              aria-current={active ? 'true' : undefined}
              className={`group flex w-28 shrink-0 flex-col gap-1 rounded-md border p-1 text-left transition-colors ${
                active
                  ? 'border-primary bg-primary/10'
                  : 'border-border hover:border-primary/60 hover:bg-card'
              }`}
            >
              <div className="relative aspect-video w-full overflow-hidden rounded bg-muted">
                {m.thumbnailUrl ? (
                  <img src={m.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                    <Icon size={20} />
                  </div>
                )}
                {/* Le type reste lisible même sur une vignette : la pastille est posée dessus. */}
                <span className="absolute left-1 top-1 rounded bg-background/80 p-0.5 text-foreground">
                  <Icon size={11} />
                </span>
                <span className="absolute right-1 top-1 rounded bg-background/80 px-1 text-2xs tabular-nums text-muted-foreground">
                  {i + 1}
                </span>
                {active && (
                  <span className="absolute bottom-1 left-1 rounded bg-primary px-1 text-2xs font-medium text-primary-foreground">
                    {t('review.assetViewing')}
                  </span>
                )}
              </div>
              <span
                className={`truncate text-2xs ${active ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'}`}
              >
                {m.originalName}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

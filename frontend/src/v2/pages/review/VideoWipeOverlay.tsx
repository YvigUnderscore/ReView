// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useRef, useState, type RefObject } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Columns2, Diff, X } from 'lucide-react';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { type MediaResp } from './reviewTypes';
import { useVideoSync } from './useVideoSync';
import { useWipe, type WipeShared } from './useWipe';
import WipeControl from './WipeControl';
import { useT } from '../../i18n';

/**
 * Comparaison A/B vidéo en mode **wipe** (14.C) : la vidéo B, synchronisée sur le maître,
 * est superposée à A et rognée par une barre déplaçable **et rotative** (clip-path
 * polygonal). À placer dans le conteneur `relative` de la vidéo A.
 */
export default function VideoWipeOverlay({
  compareId,
  masterRef,
  onClose,
  onSide,
  onDiff,
  sharedWipe,
}: {
  compareId: number;
  masterRef: RefObject<HTMLVideoElement | null>;
  onClose: () => void;
  onSide: () => void;
  /** Bascule vers le mode différence amplifiée (34.E). */
  onDiff?: () => void;
  /** Position/angle hissés (répliqués en session live). */
  sharedWipe?: WipeShared;
}) {
  const t = useT();
  const slaveRef = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);
  const wipe = useWipe(sharedWipe);

  const mediaQ = useQuery({
    queryKey: qk.media(compareId),
    queryFn: () => api.get<MediaResp>(`/api/media/${compareId}`),
    staleTime: Infinity,
  });
  const src = mediaQ.data?.proxyUrl ?? mediaQ.data?.url;

  useVideoSync(masterRef, slaveRef, ready);

  return (
    <div className="absolute inset-0 z-20 select-none">
      {src && (
        <video
          ref={slaveRef}
          src={src}
          muted
          playsInline
          onLoadedMetadata={() => setReady(true)}
          className="pointer-events-none absolute inset-0 h-full w-full object-contain"
          style={{ clipPath: wipe.clipPath }}
        />
      )}
      <WipeControl wipe={wipe} />
      {/* Contrôles flottants */}
      <div className="absolute right-2 top-2 z-40 flex items-center gap-1 rounded-md border border-border bg-card/90 px-1 py-0.5 backdrop-blur">
        <button
          onClick={onSide}
          title={t('review.compare.sideBySide')}
          className="rounded p-1 hover:bg-secondary"
        >
          <Columns2 size={14} />
        </button>
        {onDiff && (
          <button
            onClick={onDiff}
            title={t('review.compare.diffMode')}
            className="rounded p-1 hover:bg-secondary"
          >
            <Diff size={14} />
          </button>
        )}
        <button
          onClick={onClose}
          title={t('review.compare.close')}
          className="rounded p-1 hover:bg-secondary"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}

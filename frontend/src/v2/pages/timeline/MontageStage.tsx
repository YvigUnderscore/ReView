// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { FileWarning } from 'lucide-react';
import { VIEWER_ZONE } from '../review/reviewTypes';
import type { TimelineClip } from '../../types/api';
import { useT } from '../../i18n';

/**
 * L'image du montage (Phase 46), dans le même cadre que le viewer de review.
 *
 * Deux lecteurs se relaient : pendant qu'un plan joue, le suivant se charge dans le second,
 * hors écran, et la bascule n'est qu'un échange de visibilité. Les deux restent montés en
 * permanence — démonter celui qui sort annulerait le préchargement et ramènerait le noir
 * entre les plans, ce qu'un montage doit précisément éviter.
 *
 * L'annotation partage exactement la boîte de l'image, calculée à son ratio réel : un
 * dessin qui ne tombe pas sur le pixel visé ne vaut pas mieux que pas de dessin.
 */
export default function MontageStage({
  clip,
  active,
  videoA,
  videoB,
  overlay,
  onClick,
  zoneRef,
}: {
  clip: TimelineClip | null;
  active: 'A' | 'B';
  videoA: RefObject<HTMLVideoElement | null>;
  videoB: RefObject<HTMLVideoElement | null>;
  /** Calque d'annotation, rendu à la taille de l'image. */
  overlay?: ReactNode;
  onClick?: () => void;
  /** Zone d'image — cible du plein écran « vidéo seule » du transport. */
  zoneRef?: RefObject<HTMLDivElement | null>;
}) {
  const t = useT();
  const local = useRef<HTMLDivElement>(null);
  const zone = zoneRef ?? local;
  const [aspect, setAspect] = useState(16 / 9);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const card = clip !== null && clip.mediaId === null;

  // Boîte d'affichage : l'image occupe tout l'espace disponible à son ratio, et l'overlay
  // partage la même boîte — même calcul que le lecteur de review.
  useEffect(() => {
    const el = zone.current;
    if (!el) return;
    const fit = () => {
      const h = Math.min(el.clientHeight, el.clientWidth / aspect);
      setBox({ w: h * aspect, h });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [aspect, zone]);

  const onMeta = (el: HTMLVideoElement, slot: 'A' | 'B') => {
    if (slot === active && el.videoWidth > 0) setAspect(el.videoWidth / el.videoHeight);
  };

  return (
    <div ref={zone} className={VIEWER_ZONE}>
      <div className="relative" style={box ? { width: box.w, height: box.h } : undefined}>
        <video
          ref={videoA}
          onClick={onClick}
          onLoadedMetadata={(e) => onMeta(e.currentTarget, 'A')}
          className={`absolute inset-0 h-full w-full cursor-pointer object-contain ${
            active === 'A' && !card ? '' : 'invisible'
          }`}
          playsInline
          crossOrigin="anonymous"
        />
        <video
          ref={videoB}
          onClick={onClick}
          onLoadedMetadata={(e) => onMeta(e.currentTarget, 'B')}
          className={`absolute inset-0 h-full w-full cursor-pointer object-contain ${
            active === 'B' && !card ? '' : 'invisible'
          }`}
          playsInline
          crossOrigin="anonymous"
        />
        {overlay}
        {card && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted-foreground">
            <FileWarning size={30} className="text-amber-500" />
            <span className="text-sm font-medium text-foreground">{clip?.shotCode}</span>
            <span className="text-xs">{t('timeline.noMedia')}</span>
          </div>
        )}
      </div>
    </div>
  );
}

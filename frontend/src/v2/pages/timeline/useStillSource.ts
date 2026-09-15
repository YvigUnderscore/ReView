// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useState } from 'react';
import { playbackSource } from './mediaSource';
import { isStillClip } from './timelinePlayback';
import type { TimelineClip } from '../../types/api';

/**
 * Source pleine résolution des plans-image d'un montage.
 *
 * Un plan dont la version publiée est une image ne passe pas par l'élément vidéo — un JPEG
 * confié à `<video>` échoue au démultiplexage et bloquait la lecture de tout le montage. Il
 * lui faut donc sa propre source, résolue comme celle d'une vidéo (`GET /api/media/:id`) mais
 * posée dans une `<img>`.
 *
 * Les URL résolues sont conservées par média : un montage qui revient sur le même plan ne
 * redemande pas son URL, et la bascule reste instantanée. La valeur rendue se DÉRIVE de cet
 * accumulateur pendant le rendu — pas de `setState` synchrone dans un effet, qui ferait
 * cascader les rendus à chaque changement de plan.
 */
export function useStillSource(clip: TimelineClip | null): string | null {
  const [resolved, setResolved] = useState<Record<number, string>>({});
  const mediaId = isStillClip(clip) ? (clip?.mediaId ?? null) : null;

  useEffect(() => {
    if (mediaId === null || resolved[mediaId]) return;
    let cancelled = false;
    void playbackSource(mediaId)
      .then((source) => {
        const url = source?.file ?? source?.url ?? null;
        if (!cancelled && url) setResolved((prev) => ({ ...prev, [mediaId]: url }));
      })
      .catch(() => {
        // Sans URL, la vignette du plan tient la place : un montage ne tombe pas au noir.
      });
    return () => {
      cancelled = true;
    };
  }, [mediaId, resolved]);

  if (mediaId === null) return null;
  // La vignette sert d'affichage immédiat le temps que l'image pleine résolution arrive.
  return resolved[mediaId] ?? clip?.thumbnailUrl ?? null;
}

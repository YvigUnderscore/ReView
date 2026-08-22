// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useState, type RefObject } from 'react';

export interface VolumeControl {
  volume: number;
  muted: boolean;
  /** Régler à zéro coupe le son : c'est ce que le geste veut dire. */
  setVolume: (value: number) => void;
  toggleMute: () => void;
}

/** Volume et coupure du son du lecteur, appliqués à l'élément vidéo. */
export function useVolumeControl(videoRef: RefObject<HTMLVideoElement | null>): VolumeControl {
  const [volume, setLevel] = useState(1);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    const v = videoRef.current;
    if (v) {
      v.volume = volume;
      v.muted = muted;
    }
  }, [videoRef, volume, muted]);

  const setVolume = useCallback((value: number) => {
    setLevel(value);
    setMuted(value === 0);
  }, []);

  return { volume, muted, setVolume, toggleMute: useCallback(() => setMuted((m) => !m), []) };
}

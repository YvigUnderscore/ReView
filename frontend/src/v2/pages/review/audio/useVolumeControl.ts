// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useState, type RefObject } from 'react';

export interface VolumeControl {
  volume: number;
  muted: boolean;
  /** Setting to zero mutes the sound: that is what the gesture means. */
  setVolume: (value: number) => void;
  toggleMute: () => void;
}

/** Player volume and mute, applied to the video element. */
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

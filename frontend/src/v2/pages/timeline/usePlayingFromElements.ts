// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, type RefObject } from 'react';

/**
 * Keeps the "playing" state from the element's events, never from the `play()` promise.
 *
 * `play()` returns a promise that the autoplay policy rejects until a gesture has happened: we used
 * to set `playing = false` at that point. But the browser starts playback on the first gesture,
 * without going through us. The element was therefore playing while the montage clock stayed frozen —
 * the counter no longer moved, and the next shot never came. The element's `play` / `pause` events
 * are the only source that does not lie.
 *
 * Both players are listened to: the outgoing one is paused at every switch, and the incoming one must
 * then be the reference.
 */
export function usePlayingFromElements(
  videoA: RefObject<HTMLVideoElement | null>,
  videoB: RefObject<HTMLVideoElement | null>,
  setPlaying: (playing: boolean) => void,
): void {
  useEffect(() => {
    const a = videoA.current;
    const b = videoB.current;
    const elements = [a, b].filter((el): el is HTMLVideoElement => el !== null);
    const onPlay = () => setPlaying(true);
    // A pause only counts if NO player is playing any more: the outgoing buffer is paused at the
    // very moment the incoming one starts.
    const onPause = () => setPlaying(elements.some((el) => !el.paused));
    for (const el of elements) {
      el.addEventListener('play', onPlay);
      el.addEventListener('pause', onPause);
    }
    return () => {
      for (const el of elements) {
        el.removeEventListener('play', onPlay);
        el.removeEventListener('pause', onPause);
      }
    };
  }, [videoA, videoB, setPlaying]);
}

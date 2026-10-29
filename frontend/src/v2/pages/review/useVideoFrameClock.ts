// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useState, type RefObject } from 'react';
import { frameAtTime } from './frameRate';

/**
 * Player frame clock.
 *
 * The counter only followed `timeupdate`, an event specified to fire about four times per second:
 * during playback at 24 fps, the displayed frame number skipped by six, the timeline cursor advanced in
 * jerks, and range annotations lit up up to 250 ms too late. Frame stepping, however, was correct — it
 * is indeed continuous playback that lagged.
 *
 * `requestVideoFrameCallback` answers exactly this: the browser calls back on **each presented frame**
 * and provides `mediaTime`, the timestamp of that precise frame — not the player's approximate position.
 * Where it is missing (Firefox), a `requestAnimationFrame` step serves as a fallback: it only knows
 * `currentTime`, but it refreshes at the screen's rate rather than four times per second.
 *
 * `timeupdate`, `seeked` and `loadedmetadata` stay wired as a safety net: they cover pause, scrub and
 * loading, where no new frame is presented.
 */

/**
 * The DOM types announce `requestVideoFrameCallback` as available; Firefox does not implement it. It is
 * therefore made optional in the type, otherwise the fallback looks like unreachable code.
 */
type FrameCallbackApi = Partial<
  Pick<HTMLVideoElement, 'requestVideoFrameCallback' | 'cancelVideoFrameCallback'>
>;
type VideoWithFrameCallback = Omit<
  HTMLVideoElement,
  'requestVideoFrameCallback' | 'cancelVideoFrameCallback'
> &
  FrameCallbackApi;

/** The only image-metadata field we care about: the timestamp of the shown image. */
interface VideoFrameMetadataLike {
  mediaTime: number;
}

/** Can the player announce its frames? (false under Firefox and in happy-dom tests) */
export function hasFrameCallback(video: HTMLVideoElement | null): boolean {
  return typeof (video as VideoWithFrameCallback | null)?.requestVideoFrameCallback === 'function';
}

/**
 * Current frame number, refreshed frame by frame. `fps` is the **corrected** rate (see `frameRate.ts`):
 * the counter cannot be more accurate than the rate it derives from.
 */
export function useVideoFrameClock(videoRef: RefObject<HTMLVideoElement | null>, fps: number): number {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const video = videoRef.current as VideoWithFrameCallback | null;
    if (!video) return;

    let stopped = false;
    // A `setState` per presented frame costs nothing as long as the value does not change:
    // React bails out of the render when the state is identical. So we only filter the noise.
    const publish = (time: number) => setFrame(frameAtTime(time, fps));
    const fromElement = () => publish(video.currentTime);

    let rafHandle = 0;
    let vfcHandle = 0;
    let detachFallback: (() => void) | undefined;
    const onPresented = (_now: number, metadata: VideoFrameMetadataLike) => {
      if (stopped) return;
      publish(metadata.mediaTime);
      vfcHandle = video.requestVideoFrameCallback!(onPresented);
    };
    const tick = () => {
      if (stopped) return;
      fromElement();
      rafHandle = requestAnimationFrame(tick);
    };

    if (typeof video.requestVideoFrameCallback === 'function') {
      // The loop runs continuously: when stopped, the browser simply does not call back.
      vfcHandle = video.requestVideoFrameCallback(onPresented);
    } else {
      // Fallback: the loop only runs during playback, otherwise it would wake the tab sixty times per
      // second to copy a value that does not move.
      const start = () => {
        if (!rafHandle) rafHandle = requestAnimationFrame(tick);
      };
      const stop = () => {
        if (rafHandle) cancelAnimationFrame(rafHandle);
        rafHandle = 0;
        fromElement();
      };
      video.addEventListener('play', start);
      video.addEventListener('pause', stop);
      video.addEventListener('ended', stop);
      if (!video.paused) start();
      detachFallback = () => {
        video.removeEventListener('play', start);
        video.removeEventListener('pause', stop);
        video.removeEventListener('ended', stop);
      };
    }

    video.addEventListener('timeupdate', fromElement);
    video.addEventListener('seeked', fromElement);
    video.addEventListener('loadedmetadata', fromElement);
    fromElement();

    return () => {
      stopped = true;
      if (rafHandle) cancelAnimationFrame(rafHandle);
      if (vfcHandle && typeof video.cancelVideoFrameCallback === 'function')
        video.cancelVideoFrameCallback(vfcHandle);
      video.removeEventListener('timeupdate', fromElement);
      video.removeEventListener('seeked', fromElement);
      video.removeEventListener('loadedmetadata', fromElement);
      detachFallback?.();
    };
  }, [videoRef, fps]);

  return frame;
}

// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import Hls from 'hls.js';
import { getToken } from '@/lib/apiClient';
import { playbackSource } from './mediaSource';
import { usePlayingFromElements } from './usePlayingFromElements';
import { clipIndexAt, globalTimeOf, holdsOnClock, localTimeAt, nextPlayableIndex } from './timelinePlayback';
import type { TimelineClip } from '../../types/api';

/**
 * Continuous playback of a montage, without cuts (Phase 46).
 *
 * The principle is that of a two-reel projectionist: while one shot plays, the next one is already
 * loaded and ready in a second player, off-screen. At the end of the shot the two are swapped — the
 * switch is a visibility change, not a load, so the eye sees nothing pass. Loading the source at the
 * moment of switching, as a navigation would, would leave a black gap for each shot while it downloads.
 *
 * Placeholders (shots without a published media) hold their duration on a clock, without video: they
 * are part of the montage and must not be skipped.
 */

/** A playback buffer: the video element, the shot it holds ready, and its HLS stream. */
interface Buffer {
  clipIndex: number | null;
  url: string | null;
  hls: Hls | null;
}

const EMPTY: Buffer = { clipIndex: null, url: null, hls: null };

/**
 * Attaches an HLS stream to a buffer — token injected as in the review player.
 *
 * `onFatal` is the safety net: a montage whose shot refuses to load must fall back to the MP4
 * rather than display an unexplained black rectangle.
 */
function attachHls(el: HTMLVideoElement, url: string, onFatal: () => void): Hls {
  const hls = new Hls({
    xhrSetup: (xhr) => {
      const token = getToken();
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    },
  });
  hls.attachMedia(el);
  hls.loadSource(url);
  // No ABR, as in review: playback is locked on the best rendition.
  hls.on(Hls.Events.MANIFEST_PARSED, () => {
    let best = 0;
    hls.levels.forEach((l, i) => {
      if (l.height > hls.levels[best].height) best = i;
    });
    hls.currentLevel = best;
  });
  hls.on(Hls.Events.ERROR, (_e, data) => {
    if (!data.fatal) return;
    console.warn('[montage] flux HLS en échec, repli sur le MP4', data.type, data.details);
    hls.destroy();
    onFatal();
  });
  return hls;
}

export interface ContinuousPlayback {
  /** Buffer currently on screen. */
  active: 'A' | 'B';
  /** Shot on screen, and its position in the list. */
  index: number;
  clip: TimelineClip | null;
  /** Position in the whole montage, in seconds. */
  time: number;
  playing: boolean;
  toggle: () => void;
  /** Hard stop — commenting on or annotating an image requires that it no longer moves. */
  pause: () => void;
  seek: (globalTime: number) => void;
  /** Jump to a specific shot (click in the thumbnail band). */
  goToClip: (index: number) => void;
}

/**
 * The two video elements belong to the component, which places them in its JSX: a hook returning
 * its own refs would force the caller to read them during render.
 *
 * `startAt` is the montage position at which we enter. Playback starts on its own: this hook is only
 * mounted after an explicit gesture (play button, click on the band), and asking "play" again at that
 * point would be a pointless extra round trip.
 */
export function useContinuousPlayback(
  items: TimelineClip[],
  videoA: RefObject<HTMLVideoElement | null>,
  videoB: RefObject<HTMLVideoElement | null>,
  startAt = 0,
): ContinuousPlayback {
  const [active, setActive] = useState<'A' | 'B'>('A');
  // What the two players hold is part of the PLAYER's state, not the interface's: nothing on
  // screen depends on it directly. Keeping it out of render avoids as many useless renders as
  // there are preloads.
  const buffers = useRef<{ A: Buffer; B: Buffer }>({ A: EMPTY, B: EMPTY });
  const [index, setIndex] = useState(0);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  // The elapsed time of a placeholder is counted here: it has no video element to do it.
  const placeholderStart = useRef<number | null>(null);
  // …backed by a timer, for the same reason as the `timeupdate` listener of the videos: outside
  // the active tab the animation clock is frozen and the montage would stay on a gap indefinitely.
  const placeholderTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clip = items[index] ?? null;
  const other = (slot: 'A' | 'B'): 'A' | 'B' => (slot === 'A' ? 'B' : 'A');
  // A buffer's element is only read in callbacks and effects, never during render: that is the
  // condition for React to guarantee what is seen there.
  const elementOf = useCallback(
    (slot: 'A' | 'B') => (slot === 'A' ? videoA.current : videoB.current),
    [videoA, videoB],
  );

  /** Loads a shot into a buffer and returns the element ready to play. */
  const load = useCallback(
    async (slot: 'A' | 'B', clipIndex: number, startAt = 0) => {
      const target = items[clipIndex];
      // A placeholder has no source to resolve, and **neither does an image**: handing it to the
      // video element made it fail demuxing, which blocked playback of the whole montage. Preparing a
      // buffer stays asynchronous in every case: without this, the bootstrap would trigger a cascading
      // render from its effect.
      const source = await (!holdsOnClock(target) && target?.mediaId != null
        ? playbackSource(target.mediaId)
        : Promise.resolve(null));
      const el = elementOf(slot);
      // The previous stream of this buffer is destroyed before attaching another: two instances on
      // the same element would fight over its source.
      buffers.current[slot].hls?.destroy();
      let hls: Hls | null = null;
      /** Direct MP4 playback — fallback path, and the normal path when there are no renditions. */
      const playFile = (url: string) => {
        if (!el) return;
        el.src = url;
        // `auto`: we want the whole video buffered, not just its metadata — this preload is what
        // makes the switch invisible.
        el.preload = 'auto';
        el.load();
        el.currentTime = startAt;
      };
      if (el && source) {
        if (source.hls)
          hls = attachHls(el, source.url, () => {
            if (source.file) playFile(source.file);
          });
        else playFile(source.url);
        if (source.hls) el.currentTime = startAt;
      }
      buffers.current = { ...buffers.current, [slot]: { clipIndex, url: source?.url ?? null, hls } };
    },
    [items, elementOf],
  );

  // A montage left behind must not leave two HLS streams open.
  useEffect(
    () => () => {
      // Read on unmount: `load` replaces the buffers object, so a capture at attach time would only
      // destroy streams already forgotten.
      buffers.current.A.hls?.destroy();
      buffers.current.B.hls?.destroy();
    },
    [],
  );

  /** Prepares the next playable shot in the inactive buffer. */
  const preloadNext = useCallback(
    (fromIndex: number, activeSlot: 'A' | 'B') => {
      const next = nextPlayableIndex(items, fromIndex);
      if (next < 0) return;
      void load(other(activeSlot), next);
    },
    [items, load],
  );

  const clearPlaceholderTimer = useCallback(() => {
    if (placeholderTimer.current !== null) clearTimeout(placeholderTimer.current);
    placeholderTimer.current = null;
  }, []);

  // `swap` arms itself through this reference: the function and its timer call each other, and
  // only an indirection breaks the declaration cycle.
  const swapRef = useRef<() => void>(() => {});

  /** Schedules the exit of a placeholder once its duration has elapsed. */
  const armPlaceholderTimer = useCallback(
    (duration: number) => {
      clearPlaceholderTimer();
      placeholderTimer.current = setTimeout(() => swapRef.current(), Math.max(0, duration * 1000));
    },
    [clearPlaceholderTimer],
  );

  /**
   * Starts playback at a given position of a shot, whatever its nature.
   *
   * A placeholder has no video element to start: its timer holds its duration. Going through this
   * single entry point prevents any of the three paths that start playback (bootstrap, pause/resume,
   * seek) from forgetting that case.
   */
  const begin = useCallback(
    (slot: 'A' | 'B', targetIndex: number, localStart: number) => {
      const target = items[targetIndex];
      if (!target) return;
      setPlaying(true);
      if (holdsOnClock(target)) {
        placeholderStart.current = performance.now() - localStart * 1000;
        armPlaceholderTimer(target.duration - localStart);
        return;
      }
      placeholderStart.current = null;
      clearPlaceholderTimer();
      void elementOf(slot)
        ?.play()
        .catch(() => setPlaying(false));
    },
    [items, elementOf, armPlaceholderTimer, clearPlaceholderTimer],
  );

  /**
   * Moves on to the next shot of the montage.
   *
   * "Next" means the following shot in the list, placeholder included: a gap takes its place on
   * screen for its duration, otherwise the film would not last what the time bar announces and what
   * is missing would no longer be visible. The preload, for its part, targets the next FILMED shot —
   * while a placeholder is shown, the next video finishes loading.
   */
  const swap = useCallback(() => {
    const nextIndex = index + 1;
    const next = items[nextIndex];
    if (!next) {
      setPlaying(false);
      return;
    }
    setIndex(nextIndex);
    setTime(next.startTime);

    if (holdsOnClock(next)) {
      elementOf(active)?.pause();
      placeholderStart.current = performance.now();
      armPlaceholderTimer(next.duration);
      preloadNext(nextIndex, active);
      return;
    }

    const nextSlot = other(active);
    const prepared = buffers.current[nextSlot];
    placeholderStart.current = null;
    clearPlaceholderTimer();
    // Normal case: the shot was already waiting in the other buffer, the switch is instant.
    if (prepared.clipIndex === nextIndex && prepared.url) {
      // The outgoing buffer is stopped: invisible, it would otherwise keep playing its
      // audio and consuming decoding behind the next shot.
      elementOf(active)?.pause();
      setActive(nextSlot);
      void elementOf(nextSlot)
        ?.play()
        .catch(() => setPlaying(false));
      preloadNext(nextIndex, nextSlot);
      return;
    }
    // Fallback case (manual seek just before the end of a shot): load in place.
    void load(active, nextIndex).then(() => {
      void elementOf(active)
        ?.play()
        .catch(() => setPlaying(false));
      preloadNext(nextIndex, active);
    });
  }, [active, index, items, preloadNext, elementOf, load, armPlaceholderTimer, clearPlaceholderTimer]);

  // The placeholder timer always calls the current version of `swap`.
  useEffect(() => {
    swapRef.current = swap;
  }, [swap]);

  // A montage left during a placeholder must not leave a timer behind.
  useEffect(() => clearPlaceholderTimer, [clearPlaceholderTimer]);

  // Bootstrap, in two steps. The start position is a state adjustment DURING render (an accepted
  // React pattern): shots arrive from a request, so the initial state cannot be computed on the first
  // render. Loading, on the other hand, is a side effect and stays in an effect.
  const [started, setStarted] = useState(false);
  if (!started && items.length > 0) {
    // We enter where the user clicked, placeholder included: skipping a starting gap would make the
    // film start somewhere other than where the band showed it.
    const first = Math.max(0, clipIndexAt(items, startAt));
    setStarted(true);
    setIndex(first);
    setTime(globalTimeOf(items[first], startAt - items[first].startTime));
  }

  // Loading the first shot is asynchronous: without this lock, a render happening before it
  // resolves would restart the bootstrap and play the same shot twice.
  const bootstrapped = useRef(false);
  useEffect(() => {
    if (!started || bootstrapped.current) return;
    const target = items[index];
    if (!target) return;
    bootstrapped.current = true;
    const local = localTimeAt(target, startAt);
    void load('A', index, local).then(() => {
      preloadNext(index, 'A');
      begin('A', index, local);
    });
  }, [started, index, items, startAt, load, preloadNext, begin]);

  // The "playing" state is read from the elements, not from the `play()` promise.
  usePlayingFromElements(videoA, videoB, setPlaying);

  // Clock: the video for a filmed shot, `performance.now()` for a placeholder.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const current = items[index];
      // It is the CURRENT SHOT that says which clock to follow, never the buffer: the outgoing buffer
      // keeps its source during a placeholder, and relying on it would compare the previous shot's
      // position with the gap's duration — thus skipping the gap as soon as it is shown.
      if (current && holdsOnClock(current)) {
        if (placeholderStart.current !== null) {
          const elapsed = (performance.now() - placeholderStart.current) / 1000;
          setTime(globalTimeOf(current, elapsed));
          if (elapsed >= current.duration) swap();
        }
      } else if (current) {
        const el = elementOf(active);
        if (buffers.current[active].url && el) {
          // The reference duration is that of the MONTAGE, not the file's. A media longer than the
          // slot it was given is cut here: without this the time bar would lie, and a single
          // badly probed shot would shift the whole film.
          if (el.currentTime >= current.duration) swap();
          else setTime(globalTimeOf(current, el.currentTime));
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, index, active, items, swap, elementOf]);

  // End of a filmed shot: chain onto the buffer already ready.
  useEffect(() => {
    const el = elementOf(active);
    if (!el) return;
    const onEnded = () => swap();
    /*
     * Safety net for the cut at the montage duration. The browser freezes
     * `requestAnimationFrame` as soon as the tab goes to the background, while it keeps playing the
     * video: without this listener, a shot left in the background would run over the whole length of
     * its file and shift the rest of the film. `timeupdate` is emitted in every case.
     */
    const onTimeUpdate = () => {
      const current = items[index];
      // Same rule as the clock: during a placeholder, this element is no longer the film.
      if (current && !holdsOnClock(current) && el.currentTime >= current.duration) swap();
    };
    el.addEventListener('ended', onEnded);
    el.addEventListener('timeupdate', onTimeUpdate);
    return () => {
      el.removeEventListener('ended', onEnded);
      el.removeEventListener('timeupdate', onTimeUpdate);
    };
  }, [active, swap, elementOf, items, index]);

  const pause = useCallback(() => {
    elementOf(active)?.pause();
    placeholderStart.current = null;
    clearPlaceholderTimer();
    setPlaying(false);
  }, [active, elementOf, clearPlaceholderTimer]);

  const toggle = useCallback(() => {
    if (playing) {
      pause();
      return;
    }
    // Resume where we stopped, including in the middle of a placeholder.
    begin(active, index, time - (clip?.startTime ?? 0));
  }, [active, index, playing, time, clip, begin, pause]);

  const goTo = useCallback(
    (targetIndex: number, localStart: number) => {
      const target = items[targetIndex];
      if (!target) return;
      setIndex(targetIndex);
      setTime(globalTimeOf(target, localStart));
      placeholderStart.current = null;
      clearPlaceholderTimer();
      // The targeted shot takes the active buffer: the inactive buffer will pick up the next one.
      void load(active, targetIndex, localStart).then(() => {
        if (playing) begin(active, targetIndex, localStart);
        preloadNext(targetIndex, active);
      });
    },
    [items, active, load, preloadNext, playing, begin, clearPlaceholderTimer],
  );

  const seek = useCallback(
    (globalTime: number) => {
      const targetIndex = clipIndexAt(items, globalTime);
      if (targetIndex < 0) return;
      const target = items[targetIndex];
      const local = localTimeAt(target, globalTime);
      // Seeking within the current shot: a simple `currentTime` is enough, no need to reload the source.
      if (targetIndex === index && buffers.current[active].url) {
        const el = elementOf(active);
        if (el) el.currentTime = local;
        setTime(globalTime);
        return;
      }
      goTo(targetIndex, local);
    },
    [items, index, active, goTo, elementOf],
  );

  return {
    active,
    index,
    clip,
    time,
    playing,
    toggle,
    pause,
    seek,
    goToClip: (i: number) => goTo(i, 0),
  };
}

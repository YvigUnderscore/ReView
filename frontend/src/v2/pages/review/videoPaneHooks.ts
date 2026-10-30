// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useState, type RefObject } from 'react';

/**
 * Hooks of the video pane (extracted from VideoPane, budget 300): player buffering and the displayed
 * playback speed (34.C).
 */

/**
 * I/O loop wrap (feedback 34): we only jump back to point I **during playback** — during manual
 * navigation (pause, scrub, arrows) one must be able to freely pass point O — and only if the loop is
 * enabled (the toggle does not remove the I/O points).
 */
export function shouldLoopBack(
  loopIn: number | null,
  loopOut: number | null,
  enabled: boolean,
  paused: boolean,
  currentTime: number,
): boolean {
  return (
    enabled && !paused && loopIn != null && loopOut != null && loopOut > loopIn && currentTime >= loopOut
  );
}

/**
 * Player I/O loop points: marking at the current frame (I/O shortcuts), clearing (Shift+I/O or ×), and a
 * switchable enable — disabling the loop **keeps** the points (feedback 34). Setting a point re-enables
 * the loop.
 */
export function useLoopPoints(videoRef: RefObject<HTMLVideoElement | null>) {
  const [loopIn, setLoopIn] = useState<number | null>(null);
  const [loopOut, setLoopOut] = useState<number | null>(null);
  const [enabled, setEnabled] = useState(true);
  const markIn = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    setLoopIn(v.currentTime);
    setEnabled(true);
  }, [videoRef]);
  const markOut = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    setLoopOut(v.currentTime);
    setEnabled(true);
  }, [videoRef]);
  const clear = useCallback(() => {
    setLoopIn(null);
    setLoopOut(null);
  }, []);
  const toggleEnabled = useCallback(() => setEnabled((e) => !e), []);
  return { loopIn, loopOut, enabled, markIn, markOut, clear, toggleEnabled };
}

/**
 * Player buffering: true when the video waits for data (seek/quality switch), with a slight
 * anti-flicker delay — drives the discreet spinner on the viewer.
 */
export function useVideoBuffering(videoRef: RefObject<HTMLVideoElement | null>, src: string) {
  const [buffering, setBuffering] = useState(false);
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    let timer: number | undefined;
    const start = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setBuffering(true), 180);
    };
    const stop = () => {
      window.clearTimeout(timer);
      setBuffering(false);
    };
    const startEvents = ['waiting', 'seeking', 'stalled'] as const;
    const stopEvents = ['playing', 'canplay', 'seeked'] as const;
    startEvents.forEach((e) => v.addEventListener(e, start));
    stopEvents.forEach((e) => v.addEventListener(e, stop));
    return () => {
      window.clearTimeout(timer);
      startEvents.forEach((e) => v.removeEventListener(e, start));
      stopEvents.forEach((e) => v.removeEventListener(e, stop));
    };
  }, [videoRef, src]);
  return buffering;
}

/**
 * Displayed playback speed (34.C): the J reverse playback (rAF shuttle, negative speed) takes precedence
 * over `playbackRate` (cumulated L). `visible` as soon as we are not in normal ×1 playback.
 */
export function usePlaybackSpeed(
  videoRef: RefObject<HTMLVideoElement | null>,
  src: string,
  playing: boolean,
) {
  const [shuttleSpeed, setShuttleSpeed] = useState<number | null>(null);
  const [rate, setRate] = useState(1);
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onRate = () => setRate(v.playbackRate);
    v.addEventListener('ratechange', onRate);
    return () => v.removeEventListener('ratechange', onRate);
  }, [videoRef, src]);
  const speed = shuttleSpeed ?? rate;
  return {
    speed,
    visible: (shuttleSpeed != null || (playing && rate !== 1)) && speed !== 1,
    onShuttle: setShuttleSpeed,
  };
}

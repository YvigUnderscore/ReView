// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

/**
 * Display modes of the review viewer (42.A):
 * - **browser fullscreen** (Fullscreen API on the review root);
 * - **theater mode** (№76): full-frame in-window overlay (sidebar/header hidden), distinct from
 *   fullscreen; Escape exits;
 * - **detachable player** (№75): the video element's native Picture-in-Picture.
 */
export function useReviewViewport(videoRef: RefObject<HTMLVideoElement | null>) {
  const reviewRootRef = useRef<HTMLDivElement>(null);

  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const onFs = () => setIsFullscreen(document.fullscreenElement === reviewRootRef.current);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void reviewRootRef.current?.requestFullscreen?.();
  }, []);

  const [theater, setTheater] = useState(false);
  useEffect(() => {
    if (!theater) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setTheater(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [theater]);

  const togglePictureInPicture = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    if (document.pictureInPictureElement) void document.exitPictureInPicture();
    else void el.requestPictureInPicture?.().catch(() => {});
  }, [videoRef]);

  return { reviewRootRef, isFullscreen, toggleFullscreen, theater, setTheater, togglePictureInPicture };
}

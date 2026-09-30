// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

/**
 * Modes d'affichage du viewer de review (42.A) :
 * - **plein écran navigateur** (Fullscreen API sur la racine review) ;
 * - **mode théâtre** (№76) : superposition in-window plein cadre (sidebar/en-tête masqués),
 *   distincte du plein écran ; Échap quitte ;
 * - **lecteur détachable** (№75) : Picture-in-Picture natif de l'élément vidéo.
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

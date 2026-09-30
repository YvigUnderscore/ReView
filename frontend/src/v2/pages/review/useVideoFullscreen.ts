// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

/**
 * Plein écran vidéo **immersif** : la vidéo occupe tout l'écran et la playbar devient un
 * bandeau translucide qui s'efface après 1 s sans mouvement de souris (curseur masqué avec).
 * `paneRef` = élément mis en plein écran. Complémentaire du plein écran unifié de la page.
 *
 * - `active` : le plein écran vidéo seule est en cours ;
 * - `controlsVisible` : la playbar est visible (révélée au mouvement, masquée après 1 s) ;
 * - `poke` : à appeler sur mouvement de souris pour révéler la playbar et relancer le délai ;
 * - `toggle` : entre/sort du plein écran vidéo seule.
 */
export function useVideoFullscreen(paneRef: RefObject<HTMLElement | null>) {
  const [active, setActive] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const hideTimer = useRef<number | undefined>(undefined);

  const poke = useCallback(() => {
    setControlsVisible(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setControlsVisible(false), 1000);
  }, []);

  // setState vit dans le handler d'événement (pas le corps de l'effet) : entrée en plein
  // écran → on lance l'auto-masquage ; sortie → playbar rétablie et timer purgé.
  useEffect(() => {
    const onFs = () => {
      const on = document.fullscreenElement === paneRef.current;
      setActive(on);
      if (on) poke();
      else {
        window.clearTimeout(hideTimer.current);
        setControlsVisible(true);
      }
    };
    document.addEventListener('fullscreenchange', onFs);
    return () => {
      document.removeEventListener('fullscreenchange', onFs);
      window.clearTimeout(hideTimer.current);
    };
  }, [paneRef, poke]);

  const toggle = useCallback(() => {
    if (document.fullscreenElement === paneRef.current) void document.exitFullscreen();
    else void paneRef.current?.requestFullscreen?.();
  }, [paneRef]);

  return { active, controlsVisible, poke, toggle };
}

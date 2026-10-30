// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

/**
 * **Immersive** video fullscreen: the video fills the screen and the playbar becomes a translucent strip
 * that fades after 1 s without mouse movement (the cursor hides with it). `paneRef` = element put in
 * fullscreen. Complementary to the page's unified fullscreen.
 *
 * - `active`: video-only fullscreen is in progress;
 * - `controlsVisible`: the playbar is visible (revealed on movement, hidden after 1 s);
 * - `poke`: to call on mouse movement to reveal the playbar and restart the delay;
 * - `toggle`: enters/exits video-only fullscreen.
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

  // setState lives in the event handler (not in the effect body): entering fullscreen starts the
  // auto-hide; exiting restores the playbar and purges the timer.
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

// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef, useState } from 'react';
import { resolveDisplayView, type ProjectColor } from './colorSettings';
import { useDisplayLut, useOcioDisplays, useSourceImage } from './colorQueries';
import { canvasToObjectUrl, renderTransform } from './renderTransform';

/**
 * Display transform of a review image: fetches the LUT of the **project's** display/view
 * pair, applies it on the GPU and renders a **transformed image overlaid** on the original
 * in the viewer's zoomed plane.
 *
 * There is no longer any adjustment at review time (Phase 50): colour management is the
 * studio's, defined in the project settings. The hook therefore has no state left to read:
 * the project config is enough to decide what is displayed.
 *
 * Why an overlay rather than replacing the source: the viewer re-frames on every change of
 * `src` (it resets `base`). Replacing the source would flatten the zoom and pan. The overlay
 * leaves the viewer, its annotations, pinned references and session sync intact.
 */

export interface DisplayTransform {
  /** URL of the transformed image to overlay, or `null` (nothing to overlay). */
  url: string | null;
}

/** Delay before re-rendering: a media change must not trigger two encodings. */
const RENDER_DEBOUNCE_MS = 140;

export function useDisplayTransform(src: string, projectColor: ProjectColor | null): DisplayTransform {
  const displaysQuery = useOcioDisplays(projectColor?.configId);
  const target = resolveDisplayView(projectColor, displaysQuery.data ?? []);

  const lutQuery = useDisplayLut(target);
  // Without a baked LUT there is nothing to apply: the original image is already the right answer.
  const lut = lutQuery.data?.lut ?? null;

  const imageQuery = useSourceImage(src, !!lut);
  const [url, setUrl] = useState<string | null>(null);
  const held = useRef<string | null>(null);

  const publish = (next: string | null): void => {
    const prev = held.current;
    held.current = next;
    setUrl(next);
    // The browser keeps the already-decoded image alive: revoking the old URL immediately
    // does not flicker the display, and frees the blob.
    if (prev) URL.revokeObjectURL(prev);
  };

  const image = imageQuery.data ?? null;

  useEffect(() => {
    let cancelled = false;
    // Everything goes through the delay, including clearing: setting state in the effect
    // body would add one extra render on every media change.
    const timer = setTimeout(() => {
      if (!lut || !image) {
        publish(null);
        return;
      }
      const result = renderTransform(image, image.naturalWidth, image.naturalHeight, lut);
      // WebGL-less browser: render the original image rather than a stale overlay.
      if (!result) {
        publish(null);
        return;
      }
      void canvasToObjectUrl(result.canvas).then((objectUrl) => {
        if (cancelled || !objectUrl) {
          if (objectUrl) URL.revokeObjectURL(objectUrl);
          return;
        }
        publish(objectUrl);
      });
    }, RENDER_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // `publish` is stable (refs + setState); the list carries everything that changes the image.
  }, [image, lut]);

  // Last URL released on unmount: otherwise a round trip into the review leaks one blob
  // per visited media.
  useEffect(
    () => () => {
      if (held.current) URL.revokeObjectURL(held.current);
      held.current = null;
    },
    [],
  );

  // The overlaid image is **derived**: as soon as the transform is no longer needed, it
  // disappears in the current render, without waiting for the effect to release the blob.
  return { url: lut ? url : null };
}

// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useState, type RefObject } from 'react';
import type { DocChapter } from './docsRender';

/** Top margin (px): a heading counts as reached slightly before touching the edge. */
const OFFSET = 96;

/**
 * Chapter currently being read, tracked on scroll.
 *
 * Direct measurement rather than `IntersectionObserver`: the question asked is not "is this
 * heading visible?" but "what is the last heading passed?", and a heading followed by three
 * screens of text is visible on none of them. The measurement is aligned to an animation frame,
 * so at most one per render.
 */
export function useActiveChapter(container: RefObject<HTMLElement | null>, chapters: DocChapter[]): string {
  const [active, setActive] = useState('');

  useEffect(() => {
    const el = container.current;
    const first = chapters[0];
    // Without a chapter, the retained value is no longer read: the table of contents is not shown.
    if (!el || !first) return;

    let frame = 0;
    const measure = () => {
      frame = 0;
      const limit = el.getBoundingClientRect().top + OFFSET;
      let current = first.id;
      for (const chapter of chapters) {
        const heading = document.getElementById(chapter.id);
        if (heading && heading.getBoundingClientRect().top <= limit) current = chapter.id;
      }
      setActive(current);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };

    measure();
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [container, chapters]);

  return active;
}

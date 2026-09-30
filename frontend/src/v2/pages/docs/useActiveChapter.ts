// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useState, type RefObject } from 'react';
import type { DocChapter } from './docsRender';

/** Marge haute (px) : un titre compte comme « atteint » un peu avant de toucher le bord. */
const OFFSET = 96;

/**
 * Chapitre en cours de lecture, suivi au défilement.
 *
 * Mesure directe plutôt qu'`IntersectionObserver` : la question posée n'est pas « ce titre
 * est-il visible ? » mais « quel est le dernier titre franchi ? », et un titre suivi de
 * trois écrans de texte n'est visible sur aucun d'eux. La mesure est calée sur une frame
 * d'animation, donc au plus une par rendu.
 */
export function useActiveChapter(container: RefObject<HTMLElement | null>, chapters: DocChapter[]): string {
  const [active, setActive] = useState('');

  useEffect(() => {
    const el = container.current;
    const first = chapters[0];
    // Sans chapitre, la valeur retenue n'est plus lue : le sommaire ne s'affiche pas.
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

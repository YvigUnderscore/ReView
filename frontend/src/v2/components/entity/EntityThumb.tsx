// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { thumbAbbrev, thumbScale } from '../../lib/entityThumbLabel';

/**
 * Thumbnail of an element: its image, or its **name** as long as no image exists.
 *
 * A new project, a sequence just created, two hundred shots imported from a CSV: the grids showed the same grey
 * image icon repeated, so nothing distinguished one card from another before reading its title, further down and
 * smaller. The name therefore becomes the default image: it is the only thing known about the element before its
 * first media, and it is already what one looks for at a glance.
 *
 * The fallback disappears by itself: the effective thumbnail is resolved server-side
 * (`backend/src/lib/thumbnails.ts`), which falls back to that of the element's first published media as soon as
 * an image arrives.
 */
export interface EntityThumbProps {
  /** Effective thumbnail, if the element has one (chosen thumbnail or first media). */
  url?: string | null;
  /** Name of the element: it is the default image. */
  name: string;
  /** `card`: the full name; `mini`: its abbreviation, below 40 px on a side. */
  variant?: 'card' | 'mini';
  /** Caller classes (hover transitions, rounding…), applied to the image as well as to the fallback. */
  className?: string;
}

export default function EntityThumb({ url, name, variant = 'card', className = '' }: EntityThumbProps) {
  if (url) {
    // Lazy loading: a grid of a hundred shots would otherwise request a hundred 640 px JPEGs (4 to 8 MB)
    // at mount, to display only a dozen on screen.
    return (
      <img
        src={url}
        alt=""
        loading="lazy"
        decoding="async"
        className={`h-full w-full object-cover ${className}`}
      />
    );
  }

  const mini = variant === 'mini';
  const label = mini ? thumbAbbrev(name) : name;
  return (
    // `aria-hidden`: the name is already carried by the card's or page's title; repeating it would make
    // the screen reader say the same thing twice.
    <span
      aria-hidden="true"
      className={`flex h-full w-full items-center justify-center overflow-hidden bg-gradient-to-br from-primary/15 to-secondary/60 text-center font-semibold leading-tight text-foreground/70 ${
        // Below 40 px, no margin and no line wrap: "020" used to break into "02" then "0", two unreadable
        // lines where the abbreviation fits on one.
        mini ? 'text-2xs tracking-tight' : `px-1.5 ${thumbScale(label)}`
      } ${className}`}
    >
      <span className={mini ? 'truncate' : 'line-clamp-3 break-words'}>{label}</span>
    </span>
  );
}

// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { isClipped, plainLength } from './collapse';
import { useT } from '../../i18n';

/**
 * Content that does not fit its surface opens collapsed (D6) and expands on click.
 *
 * The full text stays IN the document: it is masked by height, never truncated.
 * Ctrl+F, screen readers and browser search still find it, collapsed or not, and the
 * indicator says what is hidden.
 *
 * Two clamps, one pattern: a comment in a thread is masked by HEIGHT (`max-h`), while a
 * remark on a point of interest is cut by LINES (`lines`), three at most, otherwise the
 * cards anchored in the scene hide what the reader needs to re-read.
 *
 * The indicator is no longer derived from the character count: it follows the MEASURED
 * overflow (`isClipped`). Estimating was wrong on both sides: a "expand 77 characters"
 * button that revealed nothing in a wide thread, and a truncated comment with no button to
 * open it once the column narrowed.
 */

/**
 * Tight clamp: how many lines stay readable. Tailwind only sees classes written out in
 * full, hence the table rather than a class composed on the fly.
 */
const CLAMP_CLASS = { 3: 'line-clamp-3' } as const;

/** Default collapse: a height, that of a thread comment one hovers over. */
const MAX_HEIGHT_CLASS = 'max-h-32 overflow-hidden';

export default function CollapsibleText({
  text,
  lines,
  className,
  children,
}: {
  text: string;
  /** Tight clamp: the content shows only N lines until it is expanded. */
  lines?: keyof typeof CLAMP_CLASS;
  /**
   * Classes of the collapsed content. Clamping LINES happens on the element that carries them:
   * a block placed between it and the text would cancel the clamp, hence these classes are
   * here and not on a child.
   */
  className?: string;
  children: ReactNode;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [clipped, setClipped] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  /**
   * Does the collapse really hide anything? It is measured on the collapsed element, and
   * re-measured when the surface changes size: the width decides how many characters fit on
   * a line, and it moves (resized panel, anchored card switching sides, window).
   *
   * Once expanded, the element no longer overflows: the last measure is kept, otherwise the
   * collapse indicator would vanish at the very moment it is needed.
   */
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el || open) return;
    const measure = () => setClipped(isClipped(el));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [text, open]);

  const clamp = lines ? CLAMP_CLASS[lines] : MAX_HEIGHT_CLASS;

  return (
    <div>
      <div ref={bodyRef} className={`${className ?? ''} ${open ? '' : clamp}`.trim() || undefined}>
        {children}
      </div>
      {clipped && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setOpen((o) => !o);
          }}
          className="mt-0.5 flex items-center gap-1 text-2xs text-muted-foreground hover:text-foreground"
        >
          {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          {open ? t('comments.collapseComment') : t('comments.expandComment', { count: plainLength(text) })}
        </button>
      )}
    </div>
  );
}

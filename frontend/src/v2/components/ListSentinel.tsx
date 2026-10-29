// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef } from 'react';
import { intlLocale, useT } from '../i18n';
import { formatListCount } from '../lib/infiniteList';
import { Button } from './ui/button';

/**
 * The "counter + sentinel" pair of paginated lists.
 *
 * A list silently truncated is a lie: the screen showed a hundred shots out of twelve
 * hundred without saying so. The counter announces what is loaded out of what exists,
 * the sentinel requests the rest when it approaches the bottom of the window, and the button
 * it carries remains the only explicit command, reachable by keyboard and without
 * `IntersectionObserver`.
 */

/**
 * Counter of a paginated list. `label` is what is read once everything is loaded: the
 * count the page displayed before pagination ("1,247 media").
 */
export function ListCount({ loaded, total, label }: { loaded: number; total: number; label?: string }) {
  const t = useT();
  const locale = intlLocale();
  if (total <= 0) return null;
  const text =
    loaded >= total && label
      ? label
      : t('list.countOf', {
          loaded: formatListCount(loaded, locale),
          total: formatListCount(total, locale),
        });
  return <p className="mb-3 text-xs text-muted-foreground">{text}</p>;
}

/**
 * Scroll sentinel: placed below the list, it requests the next page as soon as
 * it enters the viewport (400 px ahead, so that loading is finished before
 * the bottom is reached).
 */
export default function ListSentinel({
  hasMore,
  isLoading,
  onLoadMore,
}: {
  hasMore: boolean;
  isLoading: boolean;
  onLoadMore: () => void;
}) {
  const t = useT();
  const anchor = useRef<HTMLDivElement | null>(null);
  // The handler lives in a ref: the observer is not rebuilt at each render of the list,
  // it only depends on "are there pages left?".
  const handler = useRef(onLoadMore);
  useEffect(() => {
    handler.current = onLoadMore;
  }, [onLoadMore]);

  useEffect(() => {
    const element = anchor.current;
    if (!element || !hasMore || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) handler.current();
      },
      { rootMargin: '400px 0px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [hasMore]);

  if (!hasMore) return null;
  return (
    <div ref={anchor} className="flex justify-center py-4">
      <Button variant="outline" size="sm" disabled={isLoading} onClick={onLoadMore}>
        {isLoading ? t('common.loading') : t('list.loadMore')}
      </Button>
    </div>
  );
}

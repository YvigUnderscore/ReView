// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useState } from 'react';
import { initialExpansion, type PrimNode } from './usdScenegraph';

/**
 * Search and expansion of the USD scenegraph — **outside the panel**.
 *
 * The panel lives in a dock tab: switching to *Info* and back unmounted it, and the tree restarted
 * collapsed, query cleared. On a production scene, finding again the prim one was looking at then cost
 * a dozen clicks. The state therefore lives as long as the scene (`useUsdScene`), and is only cleared
 * with it.
 */
export interface ScenegraphView {
  /** Current search text. */
  query: string;
  setQuery: (query: string) => void;
  /** Expanded paths — the first two levels as long as nothing has been collapsed or expanded. */
  expanded: ReadonlySet<string>;
  /** Collapses or expands a node (chevron of the row). */
  toggle: (path: string) => void;
  /** Expands a batch of paths — reveals the selected prim (`F` on hover). */
  expand: (paths: Iterable<string>) => void;
}

export function useScenegraphView(tree: readonly PrimNode[], mediaId: number | null): ScenegraphView {
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => initialExpansion(tree));

  /**
   * Seeding of the default expansion. The tree does not exist at the first render — indexing the
   * Three scene takes a few frames — and a state initialized once and for all would have left the
   * tree entirely collapsed on arrival. So we seed it on the first non-empty tree, then never again:
   * what the user has collapsed stays collapsed.
   */
  const [seeded, setSeeded] = useState(tree.length > 0);
  if (!seeded && tree.length > 0) {
    setSeeded(true);
    setExpanded(initialExpansion(tree));
  }

  /** Media change: the search and the expansion belong to the scene being left. */
  const [lastMediaId, setLastMediaId] = useState(mediaId);
  if (lastMediaId !== mediaId) {
    setLastMediaId(mediaId);
    setQuery('');
    setSeeded(tree.length > 0);
    setExpanded(initialExpansion(tree));
  }

  const toggle = useCallback((path: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(path)) next.add(path);
      return next;
    });
  }, []);

  const expand = useCallback((paths: Iterable<string>) => {
    setExpanded((current) => new Set([...current, ...paths]));
  }, []);

  return { query, setQuery, expanded, toggle, expand };
}

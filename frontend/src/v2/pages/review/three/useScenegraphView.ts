// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useState } from 'react';
import { initialExpansion, type PrimNode } from './usdScenegraph';

/**
 * Recherche et dépliage du scenegraph USD — **hors du panneau**.
 *
 * Le panneau vit dans un onglet du dock : passer sur *Info* puis revenir le démontait, et
 * l'arbre repartait replié, requête effacée. Sur une scène de production, retrouver le prim
 * qu'on regardait coûtait alors une dizaine de clics. L'état vit donc aussi longtemps que la
 * scène (`useUsdScene`), et ne s'efface qu'avec elle.
 */
export interface ScenegraphView {
  /** Texte de recherche courant. */
  query: string;
  setQuery: (query: string) => void;
  /** Chemins dépliés — deux premiers niveaux tant que rien n'a été plié ni déplié. */
  expanded: ReadonlySet<string>;
  /** Plie ou déplie un nœud (chevron de la rangée). */
  toggle: (path: string) => void;
  /** Déplie un lot de chemins — révélation du prim sélectionné (`F` au survol). */
  expand: (paths: Iterable<string>) => void;
}

export function useScenegraphView(tree: readonly PrimNode[], mediaId: number | null): ScenegraphView {
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => initialExpansion(tree));

  /**
   * Ensemencement du dépliage par défaut. L'arbre n'existe pas au premier rendu — l'indexation
   * de la scène Three prend quelques frames — et un état initialisé une fois pour toutes aurait
   * laissé l'arbre entièrement replié à son arrivée. On l'ensemence donc au premier arbre non
   * vide, puis plus jamais : ce que l'utilisateur a plié reste plié.
   */
  const [seeded, setSeeded] = useState(tree.length > 0);
  if (!seeded && tree.length > 0) {
    setSeeded(true);
    setExpanded(initialExpansion(tree));
  }

  /** Changement de média : la recherche et le dépliage appartiennent à la scène qu'on quitte. */
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

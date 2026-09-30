// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef } from 'react';
import { intlLocale, useT } from '../i18n';
import { formatListCount } from '../lib/infiniteList';
import { Button } from './ui/button';

/**
 * Le couple « compteur + sentinelle » des listes paginées.
 *
 * Une liste tronquée en silence est un mensonge : l'écran affichait cent plans sur douze
 * cents sans que rien ne le dise. Le compteur annonce ce qui est chargé sur ce qui existe,
 * la sentinelle demande la suite quand elle approche du bas de la fenêtre — et le bouton
 * qu'elle porte reste la seule commande explicite, atteignable au clavier et sans
 * `IntersectionObserver`.
 */

/**
 * Compteur d'une liste paginée. `label` est ce qu'on lit une fois tout chargé — le
 * décompte que la page affichait avant la pagination (« 1 247 media »).
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
 * Sentinelle de défilement : posée sous la liste, elle réclame la page suivante dès
 * qu'elle entre dans le champ (400 px d'avance, pour que le chargement soit fini avant
 * qu'on atteigne le bas).
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
  // Le gestionnaire vit dans une ref : l'observateur ne se reconstruit pas à chaque
  // rendu de la liste, il ne dépend que de « reste-t-il des pages ».
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

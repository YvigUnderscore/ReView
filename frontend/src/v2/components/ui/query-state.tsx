// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReactNode } from 'react';
import { TriangleAlert } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useT } from '../../i18n';
import EmptyState from './empty-state';
import { SkeletonRows } from './skeleton';
import { resolveQueryPhase } from './query-state.helpers';

/** Requête surveillée — structurellement satisfaite par tout retour de `useQuery`. */
interface WatchedQuery {
  isError: boolean;
  refetch: () => unknown;
}

/**
 * Bloc de substitution d'un écran alimenté par une requête : squelette tant que la donnée
 * arrive, panneau d'échec avec reprise quand le serveur a refusé. Rend `null` dès que des
 * données sont disponibles, ce qui permet de le poser en garde sans changer la forme des
 * écrans existants :
 *
 * ```tsx
 * const systemQ = useQuery({ … });
 * const system = systemQ.data;
 * if (!system) return <QueryState query={systemQ} skeleton={<SkeletonRows count={3} />} />;
 * ```
 *
 * L'échec réemploie `EmptyState` — même cadre, mêmes espacements, mêmes tokens que le reste
 * du produit ; seule la bordure passe en `destructive`, pour qu'un vide voulu et une panne
 * ne se confondent pas. La reprise appelle `refetch()` : pas de rechargement de page, et
 * l'écran se remplit dès que le serveur répond.
 */
export function QueryState({
  query,
  skeleton,
  hasData = false,
  description,
  compact = false,
  className,
}: {
  query: WatchedQuery;
  /** Rendu de chargement ; par défaut trois lignes, à ajuster à la densité de l'écran. */
  skeleton?: ReactNode;
  /** Force la phase « données présentes » : le bloc s'efface. */
  hasData?: boolean;
  /** Message d'échec sur mesure, quand la cause mérite d'être nommée. */
  description?: string;
  /** Version resserrée, pour un panneau imbriqué plutôt qu'une section entière. */
  compact?: boolean;
  className?: string;
}) {
  const t = useT();
  const phase = resolveQueryPhase({ isError: query.isError, hasData });
  if (phase === 'ready') return null;
  if (phase === 'pending') return <>{skeleton ?? <SkeletonRows count={3} />}</>;
  return (
    <EmptyState
      icon={TriangleAlert}
      title={t('queryState.title')}
      description={description ?? t('queryState.description')}
      action={t('queryState.retry')}
      onAction={() => void query.refetch()}
      compact={compact}
      className={cn('border-destructive/40', className)}
    />
  );
}

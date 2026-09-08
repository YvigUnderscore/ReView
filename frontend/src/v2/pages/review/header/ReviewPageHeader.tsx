// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReactNode } from 'react';
import { Skeleton } from '../../../components/ui/skeleton';

interface Props {
  /** Vrai quand le chrome du viewer héberge déjà l'en-tête : la page n'en rend alors aucun. */
  hosted: boolean;
  theater: boolean;
  hasData: boolean;
  hasError: boolean;
  identity: ReactNode;
  actions: ReactNode;
}

/**
 * En-tête rendu par la PAGE, pour les deux états où le chrome du viewer n'en héberge pas :
 * le chargement, et la superposition de comparaison image qui remplace la visionneuse.
 *
 * Il rend les mêmes emplacements que le chrome — c'est le même en-tête, posé ailleurs, et
 * non une seconde barre : la review en a longtemps empilé deux, c'est précisément ce que
 * cette composition supprime.
 */
export default function ReviewPageHeader({ hosted, theater, hasData, hasError, identity, actions }: Props) {
  if (hosted || theater || (!hasData && hasError)) return null;
  return (
    <div className="mb-3 flex shrink-0 flex-wrap items-center gap-3">
      {hasData ? (
        <>
          <div className="flex min-w-0 items-center gap-3">{identity}</div>
          <div className="ml-auto flex shrink-0 items-center gap-2 text-sm">{actions}</div>
        </>
      ) : (
        <>
          <Skeleton className="h-7 w-72" />
          <Skeleton className="h-7 w-44" />
        </>
      )}
    </div>
  );
}

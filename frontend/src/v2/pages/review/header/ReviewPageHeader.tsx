// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReactNode } from 'react';
import { Skeleton } from '../../../components/ui/skeleton';

interface Props {
  /** True when the viewer chrome already hosts the header: the page then renders none. */
  hosted: boolean;
  theater: boolean;
  hasData: boolean;
  hasError: boolean;
  identity: ReactNode;
  actions: ReactNode;
}

/**
 * Header rendered by the PAGE, for the two states where the viewer chrome does not host one:
 * loading, and the image comparison overlay that replaces the viewer.
 *
 * It renders the same slots as the chrome: it is the same header, placed elsewhere, not a second
 * bar. The review used to stack two for a long time, which is precisely what this composition removes.
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

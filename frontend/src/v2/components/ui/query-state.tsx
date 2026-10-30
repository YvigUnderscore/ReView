// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReactNode } from 'react';
import { TriangleAlert } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useT } from '../../i18n';
import EmptyState from './empty-state';
import { SkeletonRows } from './skeleton';
import { resolveQueryPhase } from './query-state.helpers';

/** Watched query — structurally satisfied by any return value of `useQuery`. */
interface WatchedQuery {
  isError: boolean;
  refetch: () => unknown;
}

/**
 * Substitution block for a screen fed by a query: skeleton while the data is arriving,
 * failure panel with a retry when the server refused. Renders `null` as soon as data is
 * available, which allows it to be placed as a guard without changing the shape of the
 * existing screens:
 *
 * ```tsx
 * const systemQ = useQuery({ … });
 * const system = systemQ.data;
 * if (!system) return <QueryState query={systemQ} skeleton={<SkeletonRows count={3} />} />;
 * ```
 *
 * The failure reuses `EmptyState` — same frame, same spacing, same tokens as the rest of the
 * product; only the border switches to `destructive`, so that an intended empty state and an
 * outage are not confused. The retry calls `refetch()`: no page reload, and the screen fills
 * as soon as the server responds.
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
  /** Loading render; three rows by default, to adjust to the density of the screen. */
  skeleton?: ReactNode;
  /** Forces the "data present" phase: the block disappears. */
  hasData?: boolean;
  /** Custom failure message, when the cause deserves to be named. */
  description?: string;
  /** Tighter version, for a nested panel rather than a whole section. */
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

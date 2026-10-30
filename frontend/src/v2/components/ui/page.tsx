// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

/**
 * Page width (A1). The container carries the gutter: `Shell` no longer adds one, otherwise
 * the `flush` variant could not take up all the space.
 *
 * - `default`: centred and bounded — all data pages (lists, tables, settings).
 *   Beyond ~1600 px the eye has to travel across the screen to read a row.
 * - `fluid`: full width, same gutter — kanban, board (width is useful there).
 * - `flush`: full width without gutter or bounds — review, editing (full space by design).
 */
export type PageWidth = 'default' | 'fluid' | 'flush';

const WIDTH_CLASS: Record<PageWidth, string> = {
  default: 'mx-auto w-full max-w-[1600px] p-6',
  fluid: 'w-full p-6',
  flush: 'flex h-full min-h-0 w-full flex-col',
};

export function PageContainer({
  width = 'default',
  className,
  children,
}: {
  width?: PageWidth;
  className?: string;
  children: ReactNode;
}) {
  return <div className={cn(WIDTH_CLASS[width], className)}>{children}</div>;
}

/**
 * Page header: title on the left, actions on the right, always wrapping.
 * Without `flex-wrap`, a narrow window squeezes the title instead of stacking the two blocks.
 */
export function PageHeader({
  title,
  subtitle,
  actions,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-5 flex flex-wrap items-start justify-between gap-3', className)}>
      <div className="min-w-0">
        {typeof title === 'string' ? (
          <h1 className="truncate text-xl font-semibold text-foreground">{title}</h1>
        ) : (
          title
        )}
        {subtitle != null && <div className="mt-0.5 text-sm text-muted-foreground">{subtitle}</div>}
      </div>
      {actions != null && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

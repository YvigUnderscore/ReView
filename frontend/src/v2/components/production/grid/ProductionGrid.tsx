// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useMemo, useRef, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { api } from '../../../../lib/apiClient';
import { qk } from '../../../lib/query';
import { useProjectRole } from '../../../lib/useProjectRole';
import { Button } from '../../ui/button';
import { SkeletonRows } from '../../ui/skeleton';
import GridFilterBar from './GridFilterBar';
import GridGroupLine from './GridGroupLine';
import GridLegend from './GridLegend';
import GridRowLine from './GridRowLine';
import { useGridActions } from './useGridActions';
import { HEAD_W, LINE_H, OVERSCAN, columnWidth, lineWidth } from './gridLayout';
import {
  NO_FILTERS,
  flattenGrid,
  gridSearch,
  groupBySequence,
  visibleDepartments,
  widestStatus,
  type GridFilters,
  type ProjectGrid,
} from './gridWire';
import { useT } from '../../../i18n';

/**
 * The tracking grid: one shot per row, one department per column.
 *
 * It replaces "Where the project stands", which users judged incomprehensible. What the earlier screen did not say and this
 * one does: which SHOT waits for what, who holds it, which department is not even on its schedule, and what its own status is.
 *
 * Three constraints govern the assembly. The **volume**: a hundred shots by twelve steps make twelve hundred cells, hence a
 * virtualised table that mounts only its visible window, with sticky headers by row as well as by column. The **cursor
 * pagination**, which operates on shots and never on tasks: a page never cuts a row in two. And the **collapsing per
 * sequence**, which renders exactly the earlier summary without freezing it into a second screen.
 *
 * It is no longer a `<table>`: a virtualised table is a stack of absolutely positioned elements, which the browser would no
 * longer relate as rows and columns. The ARIA roles restore that: without them, a screen reader would read a thousand
 * buttons in a row.
 */
export default function ProductionGrid({ projectId }: { projectId: number }) {
  const t = useT();
  const { canManage } = useProjectRole(projectId);
  const [filters, setFilters] = useState<GridFilters>(NO_FILTERS);
  const [hideEmpty, setHideEmpty] = useState(false);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set<string>());
  const scrollRef = useRef<HTMLDivElement>(null);
  const actions = useGridActions(projectId, canManage);

  // The same string serves as cache key and query string: a page served under another filter's key would show the
  // neighbour's shots.
  const search = gridSearch(filters, null);
  const gridQ = useInfiniteQuery({
    queryKey: qk.projectGrid(projectId, search),
    queryFn: ({ pageParam }) =>
      api.get<ProjectGrid>(`/api/projects/${projectId}/grid${gridSearch(filters, pageParam)}`),
    initialPageParam: null as string | null,
    getNextPageParam: (last: ProjectGrid) => last.nextCursor,
    enabled: projectId > 0,
  });

  // Pages as TanStack keeps them, with no fallback: a new `?? []` on each render would invalidate the memoisation below,
  // so the pass would be redone at every scroll step.
  const pages = gridQ.data?.pages;

  // Visible columns and their width are computed in ONE pass over the data, kept from one render to the next: virtualised
  // scrolling re-renders this table at each step, and the width depends on the longest status name on the page, never on a
  // text measurement, which would cost twelve hundred layout reads per step.
  const { rows, columns, colWidth } = useMemo(() => {
    const served = (pages ?? []).flatMap((page) => page.rows);
    const shown = visibleDepartments(pages?.[0]?.departments ?? [], served, hideEmpty);
    return { rows: served, columns: shown, colWidth: columnWidth(widestStatus(served, shown, t)) };
  }, [pages, hideEmpty, t]);

  const lines = flattenGrid(groupBySequence(rows), collapsed);
  const total = pages?.[0]?.total ?? 0;

  // The React compiler gives up memoising a component that calls `useVirtualizer`: the virtualiser returns functions bound
  // to mutable state, which one would wrongly freeze. This has no consequence here: none of these functions leaves this
  // component, and the rows only receive data (shot, columns, grid gestures).
  // eslint-disable-next-line react-hooks/incompatible-library -- nothing is memoised here, see above
  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => scrollRef.current,
    // All rows have the same height: nothing to re-measure after mounting.
    estimateSize: () => LINE_H,
    overscan: OVERSCAN,
    getItemKey: (index) => lines[index].key,
  });

  const toggle = (key: string) =>
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  if (gridQ.error) return <p className="text-sm text-destructive">{gridQ.error.message}</p>;
  if (gridQ.isLoading) return <SkeletonRows count={6} />;

  const width = lineWidth(columns.length, colWidth);

  return (
    <div className="space-y-3">
      <GridFilterBar
        projectId={projectId}
        filters={filters}
        onChange={setFilters}
        hideEmpty={hideEmpty}
        onHideEmptyChange={setHideEmpty}
      />
      <GridLegend />

      {lines.length === 0 || columns.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
          {t('production.grid.empty')}
        </p>
      ) : (
        <div
          ref={scrollRef}
          role="grid"
          aria-label={t('production.grid.title')}
          aria-colcount={columns.length + 1}
          aria-rowcount={lines.length + 1}
          className="max-h-[70vh] overflow-auto rounded-lg border border-border"
        >
          <div
            role="row"
            className="sticky top-0 z-20 flex items-center border-b border-border bg-card"
            style={{ width, height: LINE_H }}
          >
            <div
              role="columnheader"
              className="sticky left-0 z-10 flex h-full items-center bg-card px-2 text-2xs font-semibold uppercase text-muted-foreground"
              style={{ width: HEAD_W }}
            >
              {t('production.grid.shot')}
            </div>
            {columns.map((department) => (
              <div
                key={department.key}
                role="columnheader"
                title={department.name}
                className="flex h-full flex-col justify-center border-l border-border/40 bg-card px-1"
                style={{ width: colWidth }}
              >
                <span className="truncate text-center text-2xs font-semibold">{department.name}</span>
                {/* The reference tint, not a colour invented by the screen: it is what links the column to the department
                    everywhere else. */}
                {department.color && (
                  <span
                    aria-hidden
                    className="mx-auto mt-0.5 h-0.5 w-6 rounded-full"
                    style={{ backgroundColor: department.color }}
                  />
                )}
              </div>
            ))}
          </div>

          <div className="relative" style={{ height: virtualizer.getTotalSize(), width }}>
            {virtualizer.getVirtualItems().map((item) => {
              const line = lines[item.index];
              return (
                <div
                  key={item.key}
                  className="absolute left-0 top-0"
                  style={{ transform: `translateY(${item.start}px)`, height: LINE_H, width }}
                >
                  {line.kind === 'group' ? (
                    <GridGroupLine
                      group={line.group}
                      columns={columns.length}
                      colWidth={colWidth}
                      collapsed={collapsed.has(line.group.key)}
                      onToggle={() => toggle(line.group.key)}
                    />
                  ) : (
                    <GridRowLine row={line.row} columns={columns} colWidth={colWidth} actions={actions} />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex items-center gap-3">
        <p className="text-2xs text-muted-foreground">{t('production.grid.total', { count: total })}</p>
        {gridQ.hasNextPage && (
          <Button
            variant="ghost"
            size="sm"
            disabled={gridQ.isFetchingNextPage}
            onClick={() => void gridQ.fetchNextPage()}
          >
            {gridQ.isFetchingNextPage ? t('common.loading') : t('list.loadMore')}
          </Button>
        )}
      </div>
    </div>
  );
}

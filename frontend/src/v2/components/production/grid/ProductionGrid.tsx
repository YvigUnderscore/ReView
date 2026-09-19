// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useRef, useState } from 'react';
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
import { COL_W, HEAD_W, LINE_H, OVERSCAN, lineWidth } from './gridLayout';
import {
  NO_FILTERS,
  flattenGrid,
  gridSearch,
  groupBySequence,
  visibleDepartments,
  type GridFilters,
  type ProjectGrid,
} from './gridWire';
import { useT } from '../../../i18n';

/**
 * La grille de suivi : un plan par ligne, un département par colonne.
 *
 * Elle remplace « Where the project stands », que l'utilisateur a jugé incompréhensible.
 * Ce que l'écran d'avant ne disait pas et qu'elle dit : quel PLAN attend quoi, qui le
 * tient, quel département n'est même pas à son programme, et quel est son statut propre.
 *
 * Trois contraintes gouvernent le montage. Le **volume** — cent plans par douze étapes
 * font douze cents cases, donc une table virtualisée qui ne monte que sa fenêtre visible
 * et des en-têtes collants en ligne comme en colonne. La **pagination par curseur**, qui
 * porte sur les plans et jamais sur les tâches : une page ne coupe pas une ligne en deux.
 * Et le **repli par sequence**, qui rend exactement le résumé d'avant sans le figer dans
 * un second écran.
 *
 * Ce n'est plus une `<table>` : une table virtualisée est un empilement d'éléments
 * absolus, que le navigateur ne relierait plus en lignes et colonnes. Les rôles ARIA les
 * rétablissent — sans eux, la synthèse vocale lirait mille boutons à la file.
 */
export default function ProductionGrid({ projectId }: { projectId: number }) {
  const t = useT();
  const { canManage } = useProjectRole(projectId);
  const [filters, setFilters] = useState<GridFilters>(NO_FILTERS);
  const [hideEmpty, setHideEmpty] = useState(false);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set<string>());
  const scrollRef = useRef<HTMLDivElement>(null);
  const actions = useGridActions(projectId, canManage);

  // La même chaîne sert de clé de cache et de query-string : une page servie sous la clé
  // d'un autre filtre montrerait les plans du voisin.
  const search = gridSearch(filters, null);
  const gridQ = useInfiniteQuery({
    queryKey: qk.projectGrid(projectId, search),
    queryFn: ({ pageParam }) =>
      api.get<ProjectGrid>(`/api/projects/${projectId}/grid${gridSearch(filters, pageParam)}`),
    initialPageParam: null as string | null,
    getNextPageParam: (last: ProjectGrid) => last.nextCursor,
    enabled: projectId > 0,
  });

  const pages = gridQ.data?.pages ?? [];
  const rows = pages.flatMap((page) => page.rows);
  const columns = visibleDepartments(pages[0]?.departments ?? [], rows, hideEmpty);
  const lines = flattenGrid(groupBySequence(rows), collapsed);
  const total = pages[0]?.total ?? 0;

  // Le compilateur React renonce à mémoïser un composant qui appelle `useVirtualizer` :
  // le virtualiseur rend des fonctions liées à un état mutable, qu'on figerait à tort.
  // C'est sans conséquence ici — aucune de ces fonctions ne sort de ce composant, et les
  // lignes ne reçoivent que des données (plan, colonnes, gestes de la grille).
  // eslint-disable-next-line react-hooks/incompatible-library -- rien n'est mémoïsé ici, cf. ci-dessus
  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => scrollRef.current,
    // Toutes les lignes ont la même hauteur : rien à remesurer après le montage.
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

  const width = lineWidth(columns.length);

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
                style={{ width: COL_W }}
              >
                <span className="truncate text-center text-2xs font-semibold">{department.name}</span>
                {/* La teinte du référentiel, pas une couleur inventée par l'écran : c'est
                    elle qui relie la colonne au département partout ailleurs. */}
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
                      collapsed={collapsed.has(line.group.key)}
                      onToggle={() => toggle(line.group.key)}
                    />
                  ) : (
                    <GridRowLine row={line.row} columns={columns} actions={actions} />
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

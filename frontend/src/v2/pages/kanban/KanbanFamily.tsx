// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { ChevronDown, ChevronRight } from 'lucide-react';
import KanbanColumn from './KanbanColumn';
import { FAMILY_LABEL_KEY, type FamilyGroup } from './kanbanColumns';
import type { BoardTask } from './kanbanTypes';
import { useT } from '../../i18n';

/**
 * Une famille de statuts, dépliable (C4).
 *
 * Quinze colonnes côte à côte ne se lisent pas. Repliée, une famille devient un simple
 * compteur : on garde « terminé » et « écarté » fermées pour travailler, on les rouvre
 * pour vérifier. Le repli est un affichage, pas un filtre — les cartes restent comptées.
 */
export default function KanbanFamily({
  group,
  tasksByColumn,
  collapsed,
  onToggle,
}: {
  group: FamilyGroup;
  tasksByColumn: Map<string, BoardTask[]>;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const t = useT();
  const total = group.columns.reduce((n, c) => n + (tasksByColumn.get(c.id)?.length ?? 0), 0);

  return (
    <section className="min-w-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        className="mb-2 flex items-center gap-1.5 rounded-md px-1 py-0.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground"
      >
        {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
        {t(FAMILY_LABEL_KEY[group.key])}
        <span className="rounded-full bg-secondary px-1.5 py-0.5 text-2xs tabular-nums normal-case">
          {total}
        </span>
      </button>
      {!collapsed && (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {group.columns.map((column) => (
            <KanbanColumn key={column.id} column={column} tasks={tasksByColumn.get(column.id) ?? []} />
          ))}
        </div>
      )}
    </section>
  );
}

// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { memo } from 'react';
import { useDroppable } from '@dnd-kit/core';
import KanbanCardList from './KanbanCardList';
import { statusSwatch } from '../../lib/contrast';
import { useTheme } from '../../stores/useTheme';
import type { Column } from './kanbanColumns';
import type { MenuEntry } from '../../lib/menuSpec';
import type { BoardTask } from './kanbanTypes';

/**
 * Colonne de statut : zone de dépôt, largeur minimale fixe (C4).
 *
 * La grille repliait les colonnes sur deux rangées dès qu'il y en avait plus de six —
 * un board ShotGrid en a quinze, et les colonnes du bas passaient sous la ligne de
 * flottaison. Une bande à largeur minimale se lit comme un vrai kanban : on fait
 * défiler horizontalement, chaque colonne garde sa place.
 *
 * La pile de cartes, elle, s'arrêtait à soixante et annonçait le reste sans permettre de
 * l'atteindre ; elle défile maintenant et ne monte que sa fenêtre (`KanbanCardList`).
 * La zone de dépôt reste la colonne entière, en-tête compris : une carte lâchée sur une
 * colonne dont on n'a pas encore fait défiler la pile arrive quand même à bon port.
 */
function KanbanColumn({
  column,
  tasks,
  menuFor,
  activeTaskId,
}: {
  column: Column;
  tasks: BoardTask[];
  menuFor?: (task: BoardTask) => MenuEntry[];
  activeTaskId?: number | null;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });
  const isDark = useTheme((s) => s.theme) === 'dark';
  const swatch = statusSwatch(column.color, isDark);

  return (
    <div
      ref={setNodeRef}
      className={`flex w-64 shrink-0 flex-col rounded-lg border p-2 transition-colors ${
        isOver ? 'border-primary bg-primary/5' : 'border-border bg-card/50'
      }`}
    >
      <div className="mb-2 flex items-center justify-between gap-2 px-1 text-xs font-medium">
        <span
          className="truncate rounded px-1.5 py-0.5"
          style={swatch ? { backgroundColor: swatch.backgroundColor, color: swatch.color } : undefined}
          title={column.label}
        >
          {column.label}
        </span>
        <span className="shrink-0 rounded-full bg-secondary px-1.5 py-0.5 text-2xs tabular-nums">
          {tasks.length}
        </span>
      </div>
      <KanbanCardList tasks={tasks} menuFor={menuFor} activeTaskId={activeTaskId} />
    </div>
  );
}

export default memo(KanbanColumn);

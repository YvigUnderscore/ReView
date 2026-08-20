// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useDroppable } from '@dnd-kit/core';
import KanbanCard from './KanbanCard';
import { statusSwatch } from '../../lib/contrast';
import { useTheme } from '../../stores/useTheme';
import type { Column } from './kanbanColumns';
import type { MenuEntry } from '../../lib/menuSpec';
import type { BoardTask } from './kanbanTypes';
import { useT } from '../../i18n';

/**
 * Colonne de statut : zone de dépôt, largeur minimale fixe (C4).
 *
 * La grille repliait les colonnes sur deux rangées dès qu'il y en avait plus de six —
 * un board ShotGrid en a quinze, et les colonnes du bas passaient sous la ligne de
 * flottaison. Une bande à largeur minimale se lit comme un vrai kanban : on fait
 * défiler horizontalement, chaque colonne garde sa place.
 *
 * Au-delà d'un certain nombre de cartes, la colonne s'arrête et annonce le reste : cinq
 * cents cartes montées d'un coup figeaient l'écran, et personne ne lit la cinq centième.
 */
const VISIBLE_CARDS = 60;

export default function KanbanColumn({
  column,
  tasks,
  menuFor,
}: {
  column: Column;
  tasks: BoardTask[];
  menuFor?: (task: BoardTask) => MenuEntry[];
}) {
  const t = useT();
  const { setNodeRef, isOver } = useDroppable({ id: column.id });
  const isDark = useTheme((s) => s.theme) === 'dark';
  const swatch = statusSwatch(column.color, isDark);
  const shown = tasks.slice(0, VISIBLE_CARDS);

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
      <div className="space-y-2">
        {shown.map((task) => (
          <KanbanCard key={task.id} task={task} entries={menuFor?.(task)} />
        ))}
      </div>
      {tasks.length > shown.length && (
        <p className="mt-2 px-1 text-2xs text-muted-foreground">
          {t('kanban.more', { count: tasks.length - shown.length })}
        </p>
      )}
    </div>
  );
}

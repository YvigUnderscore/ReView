// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { ReactNode } from 'react';
import type { WidgetDragHandle } from './WidgetShell';

/**
 * Mode réagencement d'une page composable — et **seul** module à connaître @dnd-kit (F5).
 *
 * Les trois paquets (core, sortable, utilities) pèsent 16,8 ko gzip. Ils étaient dans le
 * fichier d'entrée, donc téléchargés par tout le monde sur toutes les pages, pour un geste
 * facultatif : déplacer des tuiles. Ils arrivent maintenant au moment où l'on entre en
 * édition, et la grille hors édition reste du HTML simple — capteurs, détection de
 * collision et annonces ARIA compris. Chaque page qui l'utilise doit donc l'importer en
 * `lazy()`, jamais directement.
 *
 * Les identifiants circulent en `string` : c'est la page qui connaît son registre, et
 * c'est elle qui écarte ce qu'elle ne reconnaît pas.
 */
export interface WidgetSortableProps {
  ids: string[];
  /** Classes de la grille, partagées avec le rendu hors édition : même mise en page. */
  className: string;
  onReorder: (from: string, to: string) => void;
  /** Rend un bloc ; le troisième argument n'existe que dans ce mode. */
  renderWidget: (id: string, index: number, drag?: WidgetDragHandle) => ReactNode;
}

export default function WidgetSortable({ ids, className, onReorder, renderWidget }: WidgetSortableProps) {
  const sensors = useSensors(
    // Un seuil de quelques pixels : sans lui, un simple clic sur un bloc démarrerait un
    // glissement et avalerait le clic.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    onReorder(String(active.id), String(over.id));
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={ids} strategy={rectSortingStrategy}>
        <div className={className}>
          {ids.map((id, index) => (
            <SortableWidget key={id} id={id} index={index} renderWidget={renderWidget} />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

/** Un bloc rendu par `renderWidget`, augmenté de ce que `useSortable` lui donne. */
function SortableWidget({
  id,
  index,
  renderWidget,
}: {
  id: string;
  index: number;
  renderWidget: WidgetSortableProps['renderWidget'];
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return renderWidget(id, index, {
    ref: setNodeRef,
    style: { transform: CSS.Translate.toString(transform), transition },
    dragging: isDragging,
    // Attributs ARIA et écouteurs de dnd-kit, destinés tels quels à la poignée.
    handleProps: { ...attributes, ...listeners },
  });
}

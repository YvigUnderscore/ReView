// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { memo, useCallback, useRef } from 'react';
import { defaultRangeExtractor, useVirtualizer, type Range } from '@tanstack/react-virtual';
import KanbanCard from './KanbanCard';
import {
  CARD_ESTIMATE,
  CARD_OVERSCAN,
  activeIndexIn,
  shouldVirtualize,
  withActiveIndex,
} from './kanbanVirtual';
import type { MenuEntry } from '../../lib/menuSpec';
import type { BoardTask } from './kanbanTypes';

/**
 * La pile de cartes d'une colonne (vague 2 — échelle).
 *
 * La colonne défile pour elle-même : au-delà de sa hauteur, on la parcourt sans emporter
 * la page entière, et surtout sans monter les mille cartes qu'elle contient. En deçà
 * d'une trentaine de cartes on garde la liste simple — la fenêtre visible vaudrait de
 * toute façon la colonne entière, et rien ne change pour un petit projet.
 */

interface CardListProps {
  tasks: BoardTask[];
  menuFor?: (task: BoardTask) => MenuEntry[];
  /** Carte tenue à la souris, pour la garder montée même hors fenêtre. */
  activeTaskId?: number | null;
}

/** Hauteur maximale de la pile : au-delà, la colonne prend son propre ascenseur. */
const SCROLL = 'max-h-[68vh] overflow-y-auto overscroll-contain';

const PlainCardList = memo(function PlainCardList({ tasks, menuFor }: CardListProps) {
  return (
    <div className={`${SCROLL} space-y-2`}>
      {tasks.map((task) => (
        <KanbanCard key={task.id} task={task} menuFor={menuFor} />
      ))}
    </div>
  );
});

const VirtualCardList = memo(function VirtualCardList({
  tasks,
  menuFor,
  activeTaskId = null,
}: CardListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeIndex = activeIndexIn(tasks, activeTaskId);
  const rangeExtractor = useCallback(
    (range: Range) => withActiveIndex(defaultRangeExtractor(range), activeIndex),
    [activeIndex],
  );
  // Le compilateur React renonce à mémoïser un composant qui appelle `useVirtualizer` :
  // le virtualiseur rend des fonctions liées à un état mutable, qu'on figerait à tort.
  // C'est sans conséquence ici — la liste est mémoïsée à la main (`memo` ci-dessus) et
  // ne laisse sortir que des tâches, jamais une fonction du virtualiseur.
  // eslint-disable-next-line react-hooks/incompatible-library -- mémoïsation explicite, cf. ci-dessus
  const virtualizer = useVirtualizer({
    count: tasks.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => CARD_ESTIMATE,
    overscan: CARD_OVERSCAN,
    getItemKey: (index) => tasks[index].id,
    rangeExtractor,
  });

  return (
    <div ref={scrollRef} className={SCROLL}>
      {/* Cale à la hauteur réelle de la pile : l'ascenseur dit la vérité sur le volume. */}
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => (
          <div
            key={item.key}
            data-index={item.index}
            ref={virtualizer.measureElement}
            className="absolute left-0 top-0 w-full pb-2"
            style={{ transform: `translateY(${item.start}px)` }}
          >
            <KanbanCard task={tasks[item.index]} menuFor={menuFor} />
          </div>
        ))}
      </div>
    </div>
  );
});

export default function KanbanCardList(props: CardListProps) {
  return shouldVirtualize(props.tasks.length) ? <VirtualCardList {...props} /> : <PlainCardList {...props} />;
}

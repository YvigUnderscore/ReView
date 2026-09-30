// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { Check, MoveDiagonal2 } from 'lucide-react';
import type { WidgetSpan } from '../../../lib/widgetLayout';
import {
  OVERVIEW_ROWS,
  gridGeometry,
  resizeTarget,
  stepSize,
  type OverviewRows,
  type WidgetSize,
} from './overviewSizing';
import { useT } from '../../../i18n';

/**
 * La poignée de redimensionnement d'un bloc — le geste que l'utilisatrice a demandé.
 *
 * Elle est l'exception assumée à la règle « clic droit d'abord » : régler une taille au
 * menu, cran par cran, c'est régler une taille sans la voir. On tire donc le coin, et la
 * grille suit sous le curseur. Elle n'apparaît qu'en composition, comme la poignée de
 * déplacement : hors composition, la page reste une page.
 *
 * Ce n'est pas un décor : c'est un bouton, il prend le focus, et les quatre flèches
 * parcourent les mêmes crans que la souris — à droite et à gauche la largeur, en haut et
 * en bas la hauteur. Son nom accessible porte la taille courante, pour que le résultat du
 * geste s'entende autant qu'il se voit.
 *
 * Le glissement ne passe **pas** par `onPreview` → enregistrement à chaque pixel : chaque
 * cran franchi écrirait une préférence, soit une requête par cran. L'aperçu vit dans la
 * grille, et seul le relâchement enregistre.
 */

/** Les quatre flèches, et ce qu'elles règlent. */
const ARROWS: Record<string, { axis: 'span' | 'rows'; direction: -1 | 1 }> = {
  ArrowRight: { axis: 'span', direction: 1 },
  ArrowLeft: { axis: 'span', direction: -1 },
  ArrowDown: { axis: 'rows', direction: 1 },
  ArrowUp: { axis: 'rows', direction: -1 },
};

export interface WidgetResizeHandleProps {
  /** Titre du bloc : la poignée s'annonce par ce qu'elle redimensionne. */
  name: string;
  size: WidgetSize;
  /** Largeurs que ce bloc propose — le bornage est le même à la souris et au clavier. */
  spans: WidgetSpan[];
  /** Taille sous le curseur pendant le glissement ; `null` quand il s'achève. */
  onPreview: (size: WidgetSize | null) => void;
  /** Taille retenue — enregistrée une seule fois, au relâchement ou à la touche. */
  onCommit: (size: WidgetSize) => void;
}

const changed = (a: WidgetSize, b: WidgetSize) => a.span !== b.span || a.rows !== b.rows;

export default function WidgetResizeHandle({
  name,
  size,
  spans,
  onPreview,
  onCommit,
}: WidgetResizeHandleProps) {
  const t = useT();
  const handle = useRef<HTMLButtonElement | null>(null);

  const startDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const origin = { x: event.clientX, y: event.clientY };
    // Le pas de la grille est lu sur le conteneur du bloc, c'est-à-dire la grille
    // elle-même : elle porte les colonnes calculées et la hauteur de rangée.
    const geometry = gridGeometry(handle.current?.closest('section[data-widget]')?.parentElement ?? null);
    let target = size;

    const move = (moved: PointerEvent) => {
      target = resizeTarget(
        size,
        { dx: moved.clientX - origin.x, dy: moved.clientY - origin.y },
        geometry,
        spans,
      );
      onPreview(target);
    };
    const finish = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      onPreview(null);
      if (changed(target, size)) onCommit(target);
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const arrow = ARROWS[event.key];
    if (!arrow) return;
    event.preventDefault();
    const next = stepSize(size, arrow.axis, arrow.direction, spans);
    if (changed(next, size)) onCommit(next);
  };

  return (
    <button
      ref={handle}
      type="button"
      onPointerDown={startDrag}
      onKeyDown={onKeyDown}
      aria-label={t('overview.widget.resize', { name, width: size.span, height: size.rows })}
      title={t('overview.widget.resizeHint')}
      className="absolute bottom-1 right-1 cursor-nwse-resize rounded-sm bg-card/80 p-1 text-muted-foreground transition-colors hover:text-primary focus-visible:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <MoveDiagonal2 size={13} />
    </button>
  );
}

/**
 * Le même réglage de hauteur, au panneau : la poignée montre le résultat, la liste montre
 * la rampe. L'une sans l'autre laisserait soit un geste impossible à retrouver, soit un
 * réglage impossible à viser.
 */
export function WidgetRowsChoice({
  rows,
  onRows,
}: {
  rows: OverviewRows;
  onRows: (rows: OverviewRows) => void;
}) {
  const t = useT();
  return (
    <div className="flex flex-wrap gap-1">
      {OVERVIEW_ROWS.map((value) => (
        <button
          key={value}
          onClick={() => onRows(value)}
          className={`flex items-center gap-1 rounded border px-2 py-1 text-xs transition-colors ${
            value === rows
              ? 'border-primary bg-primary/10 text-foreground'
              : 'border-border text-muted-foreground hover:text-foreground'
          }`}
        >
          {value === rows && <Check size={11} />}
          {t('overview.widget.rows', { count: value })}
        </button>
      ))}
    </div>
  );
}

// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import Avatar from '../../Avatar';
import EntityContextMenu from '../../ui/entity-menu';
import { initialsFrom } from '../../../lib/initials';
import { FAMILY_BAR } from '../productionWire';
import { cellKind, statusName, type GridCell, type GridCellStatus, type GridDepartment } from './gridWire';
import type { GridActions } from './useGridActions';
import { intlLocale, useT, type Tr } from '../../../i18n';

/**
 * Une case de la grille : où en est CE département sur CE plan.
 *
 * La case **écrit le nom du statut** à côté de sa pastille. Elle ne le faisait pas : la
 * couleur seule obligeait à survoler chaque case pour savoir ce qu'elle disait, et une
 * légende ne nommait que les cinq familles — pas les statuts du référentiel du projet.
 * La couleur reste, et c'est bien le partage : elle se lit d'un coup d'œil sur une colonne
 * entière, le nom se lit ligne à ligne.
 *
 * Le reste (versions livrées, dernière activité, échéance) attend toujours le survol, et
 * les gestes le clic droit : douze cents cases ne se lisent pas si chacune raconte sa vie.
 *
 * Trois états, trois dessins, et c'est la distinction qui manquait le plus à l'écran
 * d'avant : une pastille pleine **et un nom** pour un travail engagé, un anneau vide pour
 * « au programme, pas commencé », un simple tiret pour « pas au programme de ce plan ».
 */

const CELL = 'flex h-full items-center border-l border-border/40';

/** Date courte, dans la langue du lecteur — jamais un format figé. */
const shortDate = (iso: string): string =>
  new Date(iso).toLocaleDateString(intlLocale(), { day: '2-digit', month: 'short' });

/**
 * Tout ce que la case sait, en une phrase — survol et synthèse vocale.
 *
 * Le département est nommé dedans : la colonne le dit en haut de la table, ce qui ne sert
 * à rien quand on est arrivé en bas au clavier.
 */
function cellLabel(cell: GridCell, department: GridDepartment, t: Tr): string {
  const parts = [department.name, statusName(cell.status, t)];
  parts.push(cell.assignee?.name ?? t('production.grid.unassigned'));
  if (cell.versionCount > 0) parts.push(t('production.grid.versions', { count: cell.versionCount }));
  if (cell.lastActivityAt)
    parts.push(t('production.grid.lastActivity', { date: shortDate(cell.lastActivityAt) }));
  if (cell.dueDate) parts.push(t('production.grid.due', { date: shortDate(cell.dueDate) }));
  return parts.join(' · ');
}

/** La pastille : teinte du référentiel si le studio en a posé une, sinon celle de la famille. */
function StatusDot({ status }: { status: GridCellStatus | null }) {
  if (status?.color) {
    return (
      <span
        aria-hidden
        className="size-2.5 shrink-0 rounded-full ring-1 ring-inset ring-black/20"
        style={{ backgroundColor: status.color }}
      />
    );
  }
  return (
    <span aria-hidden className={`size-2.5 shrink-0 rounded-full ${FAMILY_BAR[status?.family ?? 'todo']}`} />
  );
}

export default function GridCellView({
  cell,
  department,
  colWidth,
  actions,
}: {
  /** Absente quand le plan ne porte aucune case pour cette colonne — traité comme hors programme. */
  cell: GridCell | undefined;
  department: GridDepartment;
  /** Largeur de colonne du moment — réglée par le nom de statut le plus long de la page. */
  colWidth: number;
  actions: GridActions;
}) {
  const t = useT();
  const kind = cell ? cellKind(cell) : 'unscheduled';

  // Les deux cases sans tâche gardent leur marque centrée, et rien d'écrit : elles n'ont
  // pas de statut à nommer, et c'est ce vide même qui les distingue d'une case engagée.
  if (!cell || kind === 'unscheduled') {
    const label = `${department.name} · ${t('production.grid.unscheduled')}`;
    return (
      <div
        role="gridcell"
        aria-label={label}
        title={label}
        className={`${CELL} justify-center`}
        style={{ width: colWidth }}
      >
        <span aria-hidden className="h-px w-3 bg-border" />
      </div>
    );
  }

  if (kind === 'idle') {
    const label = `${department.name} · ${t('production.grid.idle')}`;
    return (
      <div
        role="gridcell"
        aria-label={label}
        title={label}
        className={`${CELL} justify-center`}
        style={{ width: colWidth }}
      >
        <span aria-hidden className="size-2.5 rounded-full border border-border" />
      </div>
    );
  }

  const label = cellLabel(cell, department, t);
  return (
    <div role="gridcell" className={CELL} style={{ width: colWidth }}>
      <EntityContextMenu entries={actions.cellMenuFor(cell)}>
        <button
          type="button"
          title={label}
          aria-label={label}
          // Le clic gauche ouvre le même menu que le clic droit : sur un pavé tactile, le
          // clic droit n'existe pas, et la règle du projet met tout geste dans ce menu.
          onClick={(event) =>
            event.currentTarget.dispatchEvent(
              new MouseEvent('contextmenu', {
                bubbles: true,
                clientX: event.clientX,
                clientY: event.clientY,
              }),
            )
          }
          // Largeur en PIXELS, pas un `w-full` : `EntityContextMenu` interpose un `<div>`
          // sans largeur entre la case et le bouton, et un pourcentage s'y résoudrait en
          // « largeur du contenu » — le nom déborderait la colonne au lieu d'y être coupé.
          // C'est le même piège que la carte de l'accueil qui se résolvait en hauteur nulle.
          // La case mesure `colWidth` bord compris (`border-box`), d'où le filet retiré.
          style={{ width: colWidth - 1 }}
          // Le bouton occupe toute la case : les pastilles s'alignent alors d'une ligne à
          // l'autre — c'est ce qui rend la colonne scannable — et la cible du clic droit
          // fait la taille de ce qu'on voit.
          className="flex min-w-0 items-center gap-1 rounded px-1.5 py-1 transition-colors hover:bg-secondary focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <StatusDot status={cell.status} />
          {/* `truncate` plutôt qu'un nom raccourci à la main : la largeur de colonne est
              déjà taillée pour le nom le plus long de la page, et le rare débordement se
              relit au survol. Aucune mesure de texte n'a lieu par case. */}
          <span className="min-w-0 flex-1 truncate text-left text-2xs leading-none">
            {statusName(cell.status, t)}
          </span>
          {cell.assignee && (
            <Avatar
              seed={cell.assignee.id}
              initials={initialsFrom(cell.assignee.name)}
              avatarUrl={actions.avatarOf(cell.assignee.id)}
              size={16}
            />
          )}
        </button>
      </EntityContextMenu>
    </div>
  );
}

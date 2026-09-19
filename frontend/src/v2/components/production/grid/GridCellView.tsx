// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import Avatar from '../../Avatar';
import EntityContextMenu from '../../ui/entity-menu';
import { initialsFrom } from '../../../lib/initials';
import { TASK_STATUS_LABEL_KEY } from '../../../lib/taskStatus';
import { FAMILY_BAR } from '../productionWire';
import { COL_W } from './gridLayout';
import { FAMILY_LABEL, cellKind, type GridCell, type GridCellStatus, type GridDepartment } from './gridWire';
import type { GridActions } from './useGridActions';
import { intlLocale, useT, type MessageKey, type Tr } from '../../../i18n';

/**
 * Une case de la grille : où en est CE département sur CE plan.
 *
 * La case ne montre que deux choses — une pastille de statut et le visage de qui la tient —
 * parce qu'une grille de douze cents cases ne se lit pas si chacune raconte sa vie. Le
 * reste (versions livrées, dernière activité, échéance) attend le survol ; les gestes
 * attendent le clic droit.
 *
 * Trois états, trois dessins, et c'est la distinction qui manquait le plus à l'écran
 * d'avant : une pastille pleine pour un travail engagé, un anneau vide pour « au programme,
 * pas commencé », un simple tiret pour « pas au programme de ce plan ».
 */

/** Libellés de l'enum figé, indexables — un code inconnu retombe sur sa famille. */
const LEGACY_LABEL: Record<string, MessageKey | undefined> = TASK_STATUS_LABEL_KEY;

const CELL = 'flex h-full items-center justify-center border-l border-border/40';

/** Date courte, dans la langue du lecteur — jamais un format figé. */
const shortDate = (iso: string): string =>
  new Date(iso).toLocaleDateString(intlLocale(), { day: '2-digit', month: 'short' });

/** Le nom du statut : celui du studio, à défaut le libellé de l'enum, à défaut la famille. */
function statusName(status: GridCellStatus | null, t: Tr): string {
  if (!status) return t('production.grid.idle');
  if (status.name) return status.name;
  return t(LEGACY_LABEL[status.code] ?? FAMILY_LABEL[status.family]);
}

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
  actions,
}: {
  /** Absente quand le plan ne porte aucune case pour cette colonne — traité comme hors programme. */
  cell: GridCell | undefined;
  department: GridDepartment;
  actions: GridActions;
}) {
  const t = useT();
  const kind = cell ? cellKind(cell) : 'unscheduled';

  if (!cell || kind === 'unscheduled') {
    const label = `${department.name} · ${t('production.grid.unscheduled')}`;
    return (
      <div role="gridcell" aria-label={label} title={label} className={CELL} style={{ width: COL_W }}>
        <span aria-hidden className="h-px w-3 bg-border" />
      </div>
    );
  }

  if (kind === 'idle') {
    const label = `${department.name} · ${t('production.grid.idle')}`;
    return (
      <div role="gridcell" aria-label={label} title={label} className={CELL} style={{ width: COL_W }}>
        <span aria-hidden className="size-2.5 rounded-full border border-border" />
      </div>
    );
  }

  const label = cellLabel(cell, department, t);
  return (
    <div role="gridcell" className={CELL} style={{ width: COL_W }}>
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
          className="flex items-center gap-1 rounded px-1 py-0.5 transition-colors hover:bg-secondary focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <StatusDot status={cell.status} />
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

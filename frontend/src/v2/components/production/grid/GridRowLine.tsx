// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Link } from 'react-router-dom';
import EntityContextMenu from '../../ui/entity-menu';
import GridCellView from './GridCellView';
import { HEAD_W, lineWidth } from './gridLayout';
import type { GridDepartment, GridRow } from './gridWire';
import type { GridActions } from './useGridActions';
import { useT } from '../../../i18n';

/**
 * Une ligne de grille : un plan, et ce que chaque département en a fait.
 *
 * La colonne de tête porte le **statut propre du plan** — il existe en base depuis le
 * circuit d'approbation et n'était affiché nulle part : on pouvait le poser par clic droit
 * dans l'arbre sans jamais le relire ensuite.
 */

/**
 * Le statut du plan, et le geste pour le changer.
 *
 * Un bouton, pas un simple texte : le menu contextuel doit être atteignable au clavier, et
 * le clic gauche ouvre le même menu — sur un pavé tactile, le clic droit n'existe pas.
 */
function ShotStatusChip({ row, actions }: { row: GridRow; actions: GridActions }) {
  const t = useT();
  const entries = actions.shotMenuFor(row);
  const name = row.status?.name ?? t('pipeline.status.none');
  return (
    <EntityContextMenu entries={entries}>
      <button
        type="button"
        aria-label={`${t('production.grid.shotStatus')} · ${name}`}
        className="flex min-w-0 max-w-[7.5rem] items-center gap-1 rounded px-1 py-0.5 transition-colors hover:bg-secondary focus:outline-none focus:ring-1 focus:ring-ring"
        onClick={(event) =>
          event.currentTarget.dispatchEvent(
            new MouseEvent('contextmenu', {
              bubbles: true,
              clientX: event.clientX,
              clientY: event.clientY,
            }),
          )
        }
      >
        {row.status?.color ? (
          <span
            aria-hidden
            className="size-2 shrink-0 rounded-full ring-1 ring-inset ring-black/20"
            style={{ backgroundColor: row.status.color }}
          />
        ) : (
          <span aria-hidden className="size-2 shrink-0 rounded-full border border-border" />
        )}
        <span className="truncate text-2xs text-muted-foreground">{name}</span>
      </button>
    </EntityContextMenu>
  );
}

export default function GridRowLine({
  row,
  columns,
  actions,
}: {
  row: GridRow;
  columns: GridDepartment[];
  actions: GridActions;
}) {
  // Les cases arrivent dans l'ordre de TOUT le référentiel ; les colonnes visibles n'en
  // sont qu'un sous-ensemble quand on masque les vides — d'où l'index par clé.
  const byKey = new Map(row.cells.map((cell) => [cell.departmentKey, cell]));
  return (
    <div
      role="row"
      className="flex h-full items-center border-b border-border/40"
      style={{ width: lineWidth(columns.length) }}
    >
      <div
        role="rowheader"
        className="sticky left-0 z-10 flex h-full min-w-0 items-center gap-1.5 bg-background px-2"
        style={{ width: HEAD_W }}
      >
        <Link
          to={`/shots/${row.shotId}`}
          title={row.name}
          className="shrink-0 text-xs font-medium hover:text-primary hover:underline"
        >
          {row.code}
        </Link>
        <ShotStatusChip row={row} actions={actions} />
      </div>
      {columns.map((department) => (
        <GridCellView
          key={department.key}
          cell={byKey.get(department.key)}
          department={department}
          actions={actions}
        />
      ))}
    </div>
  );
}

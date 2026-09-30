// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { ChevronRight } from 'lucide-react';
import { FAMILY_BAR } from '../productionWire';
import { HEAD_W, lineWidth } from './gridLayout';
import { FAMILIES, familyTally, type SequenceGroup } from './gridWire';
import { useT } from '../../../i18n';

/**
 * La ligne d'une sequence : son nom, et l'avancement de tous ses plans.
 *
 * C'est ici que la maille séquence survit à la disparition de la matrice d'avancement —
 * elle devient l'état replié de la grille. Replier une sequence rend exactement le résumé
 * d'avant ; la déplier montre quel plan attend quoi, ce que le résumé ne disait pas.
 *
 * Les couleurs de la barre sont celles que la légende nomme, juste au-dessus de la table :
 * aucune information n'est réservée au survol.
 */
export default function GridGroupLine({
  group,
  columns,
  colWidth,
  collapsed,
  onToggle,
}: {
  group: SequenceGroup;
  /** Nombre de colonnes visibles — la ligne doit faire la largeur de la table. */
  columns: number;
  /** Largeur d'une colonne de département, réglée par la table. */
  colWidth: number;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const t = useT();
  const tally = familyTally(group.rows);
  return (
    <div
      role="row"
      className="flex h-full items-center border-b border-border bg-secondary/40"
      style={{ width: lineWidth(columns, colWidth) }}
    >
      <div
        role="rowheader"
        className="sticky left-0 z-10 flex h-full min-w-0 items-center gap-1 bg-secondary px-1.5"
        style={{ width: HEAD_W }}
      >
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          className="flex min-w-0 items-center gap-1 rounded px-1 py-0.5 text-xs font-semibold transition-colors hover:bg-background focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <ChevronRight size={13} aria-hidden className={collapsed ? 'shrink-0' : 'shrink-0 rotate-90'} />
          {group.episodeCode && (
            <span className="shrink-0 text-2xs font-normal text-muted-foreground">{group.episodeCode}</span>
          )}
          <span className="truncate">{group.sequenceCode ?? t('tree.outsideSequence')}</span>
        </button>
        <span className="ml-auto shrink-0 text-2xs tabular-nums text-muted-foreground">
          {t('production.grid.shotCount', { count: group.rows.length })}
        </span>
      </div>
      <div
        role="gridcell"
        aria-colspan={columns}
        className="flex h-full min-w-0 items-center gap-2 border-l border-border/40 px-2"
      >
        {tally.total > 0 && (
          <>
            <span aria-hidden className="flex h-2 w-40 shrink-0 overflow-hidden rounded-full bg-secondary">
              {FAMILIES.map((family) =>
                tally.counts[family] > 0 ? (
                  <span
                    key={family}
                    className={FAMILY_BAR[family]}
                    style={{ width: `${(tally.counts[family] / tally.total) * 100}%` }}
                  />
                ) : null,
              )}
            </span>
            <span className="text-2xs tabular-nums text-muted-foreground">
              {t('production.grid.tally', { done: tally.done, total: tally.total })}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

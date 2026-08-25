// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Checkbox } from '../../components/ui/checkbox';
import type { BulkDeleteDomain } from '../../lib/bulkApi';
import { idsOf, isSelected, type TrashSelection } from './trashSelection';
import { useT } from '../../i18n';

/**
 * Une section de la corbeille — un domaine, ses éléments.
 *
 * Elle ne détient plus la sélection : celle-ci vit dans l'onglet, pour que « tout
 * sélectionner » veuille dire tout et non « tout, dans cette section ».
 */

export interface TrashItem {
  id: number;
  label: string;
  endpoint: string;
}

/** Case cochable qui capte les modificateurs — le clavier les porte aussi bien. */
function Box({
  checked,
  label,
  onPick,
}: {
  checked: boolean;
  label: string;
  onPick: (mods: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) => void;
}) {
  const pick = (e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) =>
    onPick({ shiftKey: e.shiftKey, metaKey: e.metaKey, ctrlKey: e.ctrlKey });
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        pick(e);
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        e.stopPropagation();
        pick(e);
      }}
    >
      <Checkbox checked={checked} onCheckedChange={() => {}} tabIndex={-1} aria-label={label} />
    </div>
  );
}

export default function TrashSection({
  title,
  domain,
  items,
  selection,
  onToggle,
  onToggleDomain,
  onRestore,
  onPurge,
}: {
  title: string;
  domain: BulkDeleteDomain;
  items: TrashItem[];
  selection: TrashSelection;
  onToggle: (domain: BulkDeleteDomain, id: number) => void;
  onToggleDomain: (domain: BulkDeleteDomain, ids: number[]) => void;
  onRestore: (endpoint: string) => void;
  onPurge: (item: TrashItem) => void;
}) {
  const t = useT();
  if (items.length === 0) return null;
  const all = items.map((it) => it.id);
  const picked = idsOf(selection, domain).length;

  return (
    <section className="mb-5">
      <div className="mb-2 flex items-center gap-2">
        <Box
          checked={picked === all.length}
          label={t('common.selectAll')}
          onPick={() => onToggleDomain(domain, all)}
        />
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
        <span className="text-2xs text-muted-foreground">{items.length}</span>
      </div>
      <div className="space-y-1.5">
        {items.map((it) => (
          <div
            key={it.endpoint}
            className="flex items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2 text-sm"
          >
            <div className="flex min-w-0 items-center gap-2.5">
              <Box
                checked={isSelected(selection, domain, it.id)}
                label={t('common.select')}
                onPick={() => onToggle(domain, it.id)}
              />
              <span className="truncate">{it.label}</span>
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                onClick={() => onRestore(it.endpoint)}
                className="rounded border border-border px-2 py-1 text-xs hover:bg-secondary/60"
              >
                {t('common.restore')}
              </button>
              <button
                onClick={() => onPurge(it)}
                className="rounded px-2 py-1 text-xs text-destructive hover:bg-secondary/60"
              >
                {t('common.deletePermanently')}
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

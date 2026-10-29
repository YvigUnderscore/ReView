// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Check } from 'lucide-react';
import EntityThumb from './EntityThumb';

/**
 * Pick elements by their image rather than by a checkbox.
 *
 * Attaching an asset to its shots used to happen in a list of checkboxes: two hundred lines of text where
 * "SQ010 · SH0120" says nothing about what is on screen. Yet one knows which shot a set appears in **by recognising
 * it**, not by reading its code.
 *
 * The thumbnail therefore carries the choice, and the selection shows in the border and the tick, not in a box in
 * the margin, which one no longer spots beyond twenty lines.
 */

export interface PickItem {
  id: number;
  label: string;
  hint?: string | null;
  thumbnailUrl?: string | null;
}

export default function PickGrid({
  items,
  selected,
  onToggle,
  emptyLabel,
}: {
  items: PickItem[];
  selected: Set<number>;
  onToggle: (id: number) => void;
  emptyLabel: string;
}) {
  if (items.length === 0) return <p className="text-xs text-muted-foreground">{emptyLabel}</p>;

  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
      {items.map((item) => {
        const picked = selected.has(item.id);
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onToggle(item.id)}
            aria-pressed={picked}
            className={`group overflow-hidden rounded-md border text-left transition-colors ${
              picked ? 'border-primary ring-1 ring-primary' : 'border-border hover:border-primary/50'
            }`}
          >
            <span className="relative flex aspect-video items-center justify-center overflow-hidden bg-secondary/40">
              <EntityThumb url={item.thumbnailUrl} name={item.label} />
              {picked && (
                <span className="absolute right-1 top-1 rounded-full bg-primary p-0.5 text-primary-foreground">
                  <Check size={11} />
                </span>
              )}
            </span>
            <span className="block px-1.5 py-1">
              <span className="block truncate text-2xs font-medium">{item.label}</span>
              {item.hint && (
                <span className="block truncate text-2xs text-muted-foreground">{item.hint}</span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

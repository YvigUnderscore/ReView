// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';

/**
 * Exclusive choice of 2 to 5 options, on a single track — render mode, gizmo space,
 * channels, comparison mode. Preferred over a row of buttons because exclusivity is seen
 * at a glance. `size="lg"` serves the header's mode switch; `iconOnly`
 * shrinks to 28 px squares for dense bars.
 */
export interface SegmentedItem<T extends string> {
  value: T;
  label: string;
  icon?: LucideIcon;
  /** Tooltip — replaces the label when `iconOnly`. */
  hint?: string;
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string> {
  items: SegmentedItem<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: 'sm' | 'lg';
  iconOnly?: boolean;
  /** Describes the group for screen readers. */
  label: string;
  className?: string;
}

export function SegmentedControl<T extends string>({
  items,
  value,
  onChange,
  size = 'sm',
  iconOnly,
  label,
  className,
}: SegmentedControlProps<T>) {
  const iconSize = size === 'lg' ? 15 : 13;
  return (
    <div
      role="group"
      aria-label={label}
      className={cn('inline-flex items-center gap-0.5 rounded-md bg-secondary/50 p-0.5', className)}
    >
      {items.map((item) => {
        const Icon = item.icon;
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            aria-pressed={active}
            title={item.hint ?? item.label}
            aria-label={iconOnly ? item.label : undefined}
            disabled={item.disabled}
            onClick={() => onChange(item.value)}
            className={cn(
              'flex items-center justify-center gap-1.5 whitespace-nowrap rounded border-0 bg-transparent font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              'disabled:cursor-not-allowed disabled:opacity-40',
              size === 'lg' ? 'min-h-8 px-3 text-sm' : 'min-h-7 px-2 text-xs',
              iconOnly && (size === 'lg' ? 'w-8 px-0' : 'w-7 px-0'),
              active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {Icon && <Icon size={iconSize} />}
            {!iconOnly && item.label}
          </button>
        );
      })}
    </div>
  );
}

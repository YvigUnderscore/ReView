// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { forwardRef, type ButtonHTMLAttributes } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Tooltip } from './tooltip';

/**
 * Icon-only button for the dense bars of the review chrome (options, transport, header).
 * Promoted from `HudIconButton` with the chrome redesign. `label` is mandatory: it serves as
 * `aria-label` and tooltip, and must include the shortcut when there is one.
 *
 * `bordered` draws the border of actions placed on a light surface; `active` marks a
 * pressed state (`aria-pressed`).
 *
 * ## Native `title` → `Tooltip` primitive
 *
 * The label is here the **only** thing that says what the button does: leaving it to the
 * native tooltip costs about 1.5 s of waiting, unthemed, and makes it unreachable by keyboard.
 * `Tooltip` shows it after 250 ms and also opens on focus.
 *
 * The `aria-label` **stays**: Radix describes the trigger (`aria-describedby`), it does not
 * name it. It is also the only information that survives on touch — where neither the native
 * tooltip nor this one opens. The native `title`, for its part, is removed: keeping it would
 * show two tooltips stacked on top of each other.
 */
export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  icon: LucideIcon;
  label: string;
  bordered?: boolean;
  active?: boolean;
  size?: number;
}

const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ icon: Icon, label, bordered, active, size = 14, className, ...props }, ref) => (
    <Tooltip label={label}>
      <button
        ref={ref}
        type="button"
        aria-label={label}
        aria-pressed={active}
        className={cn(
          'ui-pressable flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          'disabled:pointer-events-none disabled:opacity-40',
          // `bordered` is for placing the button on a light surface: it is a control boundary,
          // not a separator — hence `--border-strong` (3:1) and not `--border`.
          bordered && 'border border-border-strong',
          active
            ? 'bg-primary/15 text-primary hover:bg-primary/25 active:bg-primary/30'
            : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground active:bg-secondary',
          className,
        )}
        {...props}
      >
        <Icon size={size} />
      </button>
    </Tooltip>
  ),
);
IconButton.displayName = 'IconButton';

export { IconButton };

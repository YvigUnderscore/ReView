// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

/**
 * 30×17 toggle of the review chrome: a panel row = a label on the left, a `Switch` on the
 * right. No state text beside it — the state is read from the thumb's position.
 * `role="switch"` + `aria-checked`; `label` serves as `aria-label` and tooltip.
 */
export interface SwitchProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'onChange' | 'type' | 'role'
> {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** Describes what the switch turns on — mandatory, no bare button. */
  label: string;
}

const Switch = forwardRef<HTMLButtonElement, SwitchProps>(
  ({ checked, onCheckedChange, label, className, disabled, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'relative h-[1.0625rem] w-[1.875rem] shrink-0 cursor-pointer rounded-full border-0 p-0',
        'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        'disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-primary/30' : 'bg-secondary',
        className,
      )}
      {...props}
    >
      <span
        aria-hidden
        className={cn(
          'absolute left-[2px] top-[2px] h-[0.8125rem] w-[0.8125rem] rounded-full transition-[transform,background-color] duration-150',
          checked ? 'translate-x-[0.8125rem] bg-primary' : 'bg-muted-foreground',
        )}
      />
    </button>
  ),
);
Switch.displayName = 'Switch';

export { Switch };

// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { forwardRef, type ComponentPropsWithoutRef, type ComponentRef } from 'react';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Check } from 'lucide-react';
import { cn } from '../../lib/utils';

/**
 * Accessible checkbox (Radix). Serves multi-selection in lists (13.A): visible on hover via
 * `group-hover`, or always when checked. The Shift/Ctrl logic is carried by the caller's
 * `onClick` handler (the event's modifiers).
 */
const Checkbox = forwardRef<
  ComponentRef<typeof CheckboxPrimitive.Root>,
  ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      'flex h-4 w-4 shrink-0 items-center justify-center rounded border border-input bg-background/80 text-primary-foreground shadow-sm outline-none transition-colors',
      'focus-visible:ring-2 focus-visible:ring-ring',
      'data-[state=checked]:border-primary data-[state=checked]:bg-primary',
      /* 24 px hit area (WCAG 2.5.8) around a checkbox that keeps its 16 px drawing:
         a pseudo-element rather than a negative margin, so the box does not move in the
         tight grids where it sits. */
      'relative before:absolute before:left-1/2 before:top-1/2 before:h-6 before:w-6 before:-translate-x-1/2 before:-translate-y-1/2 before:content-[""]',
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator>
      <Check size={12} strokeWidth={3} />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = 'Checkbox';

export { Checkbox };

// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { forwardRef, type ComponentPropsWithoutRef, type ComponentRef } from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { cn } from '../../lib/utils';

/**
 * Accessible Popover (Radix): portal, automatic positioning, close on Escape/outside click,
 * focus managed. Any floating list anchored to a trigger (notifications bell…) MUST go
 * through this primitive (no hand-made overlay).
 */
const Popover = PopoverPrimitive.Root;
const PopoverTrigger = PopoverPrimitive.Trigger;
const PopoverAnchor = PopoverPrimitive.Anchor;
const PopoverClose = PopoverPrimitive.Close;

const PopoverContent = forwardRef<
  ComponentRef<typeof PopoverPrimitive.Content>,
  ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = 'end', sideOffset = 8, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      className={cn(
        'z-50 w-80 rounded-lg border border-border bg-card p-1 text-card-foreground shadow-xl outline-none',
        // A menu must not overflow off-screen without a fallback: it used to be
        // `max-height: none; overflow: visible`, so anything below the bottom of the window was
        // unreachable — no wheel, no keyboard. Radix measures the space really available below
        // (or above) the trigger and publishes it in this variable; we bound to it and scroll inside.
        'max-h-[var(--radix-popover-content-available-height)] overflow-y-auto',
        'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
        className,
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
));
PopoverContent.displayName = 'PopoverContent';

export { Popover, PopoverTrigger, PopoverAnchor, PopoverClose, PopoverContent };

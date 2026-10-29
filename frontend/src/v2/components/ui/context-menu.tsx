// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { forwardRef, type ComponentPropsWithoutRef, type ComponentRef } from 'react';
import * as ContextMenuPrimitive from '@radix-ui/react-context-menu';
import { Check, ChevronRight } from 'lucide-react';
import { cn } from '../../lib/utils';

/**
 * Accessible context menu (right click): Radix, shadcn style (13.B). Used on list items
 * (EntityCard) to group Open/Edit/Favourite/Move/Delete.
 */
// Non-modal: a modal menu sets `pointer-events: none` on the body, and when an item
// opens a Dialog during the menu's closing animation, the two locks tangle and the block
// persists after closing (page frozen: CP-HUMAIN 33 feedback). Without modality, the menu
// locks nothing; Dialogs keep their own lock, set properly.
const ContextMenu = (props: React.ComponentProps<typeof ContextMenuPrimitive.Root>) => (
  <ContextMenuPrimitive.Root modal={false} {...props} />
);
const ContextMenuTrigger = ContextMenuPrimitive.Trigger;
const ContextMenuSeparator = forwardRef<
  ComponentRef<typeof ContextMenuPrimitive.Separator>,
  ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.Separator ref={ref} className={cn('my-1 h-px bg-border', className)} {...props} />
));
ContextMenuSeparator.displayName = 'ContextMenuSeparator';

const ContextMenuContent = forwardRef<
  ComponentRef<typeof ContextMenuPrimitive.Content>,
  ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Content>
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.Portal>
    <ContextMenuPrimitive.Content
      ref={ref}
      className={cn(
        'z-50 min-w-[11rem] overflow-hidden rounded-md border border-border bg-card p-1 text-card-foreground shadow-xl outline-none',
        'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
        className,
      )}
      {...props}
    />
  </ContextMenuPrimitive.Portal>
));
ContextMenuContent.displayName = 'ContextMenuContent';

const ContextMenuItem = forwardRef<
  ComponentRef<typeof ContextMenuPrimitive.Item>,
  ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Item> & { danger?: boolean }
>(({ className, danger, onClick, onSelect, ...props }, ref) => (
  <ContextMenuPrimitive.Item
    ref={ref}
    // Action deferred until the menu has closed: opening a Dialog while the menu is
    // unmounting leaves a residual `pointer-events: none` on the body (page frozen).
    onSelect={(e) => {
      onSelect?.(e);
      if (onClick) setTimeout(() => onClick(e as unknown as React.MouseEvent<HTMLDivElement>), 0);
    }}
    className={cn(
      'flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm outline-none transition-colors',
      'focus:bg-secondary data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
      danger ? 'text-destructive focus:bg-destructive/10' : 'text-foreground',
      className,
    )}
    {...props}
  />
));
ContextMenuItem.displayName = 'ContextMenuItem';

/**
 * Single choice within a menu (status of an entity). Radix sets `role="menuitemradio"`,
 * `aria-checked` and keyboard navigation; redoing the semantics by hand on a
 * `ContextMenuItem` would be overridden by the primitive anyway.
 */
const ContextMenuRadioGroup = ContextMenuPrimitive.RadioGroup;

const ContextMenuRadioItem = forwardRef<
  ComponentRef<typeof ContextMenuPrimitive.RadioItem>,
  ComponentPropsWithoutRef<typeof ContextMenuPrimitive.RadioItem>
>(({ className, children, ...props }, ref) => (
  <ContextMenuPrimitive.RadioItem
    ref={ref}
    className={cn(
      'flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-foreground outline-none transition-colors',
      'focus:bg-secondary data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
      className,
    )}
    {...props}
  >
    {/* Fixed slot: without it, labels shift depending on which item is checked. */}
    <span className="flex w-4 shrink-0 items-center justify-center">
      <ContextMenuPrimitive.ItemIndicator>
        <Check size={13} />
      </ContextMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </ContextMenuPrimitive.RadioItem>
));
ContextMenuRadioItem.displayName = 'ContextMenuRadioItem';

/**
 * Toggle for a state (plan left out of the mount). Like the single choice, the primitive
 * carries the semantics — `role="menuitemcheckbox"` and `aria-checked` — which an ordinary
 * item with a hand-drawn tick would not have.
 */
const ContextMenuCheckboxItem = forwardRef<
  ComponentRef<typeof ContextMenuPrimitive.CheckboxItem>,
  ComponentPropsWithoutRef<typeof ContextMenuPrimitive.CheckboxItem>
>(({ className, children, ...props }, ref) => (
  <ContextMenuPrimitive.CheckboxItem
    ref={ref}
    className={cn(
      'flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-foreground outline-none transition-colors',
      'focus:bg-secondary data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
      className,
    )}
    {...props}
  >
    {/* Same fixed slot as the single choice: labels do not move. */}
    <span className="flex w-4 shrink-0 items-center justify-center">
      <ContextMenuPrimitive.ItemIndicator>
        <Check size={13} />
      </ContextMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </ContextMenuPrimitive.CheckboxItem>
));
ContextMenuCheckboxItem.displayName = 'ContextMenuCheckboxItem';

// Submenus (live role management via right click — feedback 33).
const ContextMenuSub = ContextMenuPrimitive.Sub;

const ContextMenuSubTrigger = forwardRef<
  ComponentRef<typeof ContextMenuPrimitive.SubTrigger>,
  ComponentPropsWithoutRef<typeof ContextMenuPrimitive.SubTrigger>
>(({ className, children, ...props }, ref) => (
  <ContextMenuPrimitive.SubTrigger
    ref={ref}
    className={cn(
      'flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-foreground outline-none transition-colors',
      'focus:bg-secondary data-[state=open]:bg-secondary',
      className,
    )}
    {...props}
  >
    {children}
    <ChevronRight size={14} className="ml-auto text-muted-foreground" />
  </ContextMenuPrimitive.SubTrigger>
));
ContextMenuSubTrigger.displayName = 'ContextMenuSubTrigger';

const ContextMenuSubContent = forwardRef<
  ComponentRef<typeof ContextMenuPrimitive.SubContent>,
  ComponentPropsWithoutRef<typeof ContextMenuPrimitive.SubContent>
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.Portal>
    <ContextMenuPrimitive.SubContent
      ref={ref}
      className={cn(
        'z-50 min-w-[11rem] overflow-hidden rounded-md border border-border bg-card p-1 text-card-foreground shadow-xl outline-none',
        'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
        className,
      )}
      {...props}
    />
  </ContextMenuPrimitive.Portal>
));
ContextMenuSubContent.displayName = 'ContextMenuSubContent';

export {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuCheckboxItem,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
};

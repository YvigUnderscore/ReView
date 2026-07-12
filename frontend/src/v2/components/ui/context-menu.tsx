import { forwardRef, type ComponentPropsWithoutRef, type ComponentRef } from 'react';
import * as ContextMenuPrimitive from '@radix-ui/react-context-menu';
import { cn } from '../../lib/utils';

/**
 * Menu contextuel (clic droit) accessible — Radix, style shadcn (13.B). Utilisé sur les
 * items de liste (EntityCard) pour regrouper Ouvrir/Éditer/Favori/Déplacer/Supprimer.
 */
const ContextMenu = ContextMenuPrimitive.Root;
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
>(({ className, danger, ...props }, ref) => (
  <ContextMenuPrimitive.Item
    ref={ref}
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

export { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator };

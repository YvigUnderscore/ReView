// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { forwardRef, type ComponentPropsWithoutRef, type ComponentRef } from 'react';
import * as ContextMenuPrimitive from '@radix-ui/react-context-menu';
import { Check, ChevronRight } from 'lucide-react';
import { cn } from '../../lib/utils';

/**
 * Menu contextuel (clic droit) accessible — Radix, style shadcn (13.B). Utilisé sur les
 * items de liste (EntityCard) pour regrouper Ouvrir/Éditer/Favori/Déplacer/Supprimer.
 */
// Non-modal : un menu modal pose `pointer-events: none` sur le body et, quand un item
// ouvre un Dialog pendant son animation de fermeture, les deux verrous s'emmêlent et le
// blocage persiste après fermeture (page figée — retour CP-HUMAIN 33). Sans modalité,
// le menu ne verrouille rien ; les Dialogs gardent leur propre verrou, posé proprement.
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
    // Action différée après la fermeture du menu : ouvrir un Dialog pendant que le menu
    // se démonte laisse un `pointer-events: none` résiduel sur le body (page figée).
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
 * Choix unique dans un menu (statut d'une entité). Radix pose `role="menuitemradio"`,
 * `aria-checked` et la navigation clavier ; refaire la sémantique à la main sur un
 * `ContextMenuItem` serait de toute façon écrasé par la primitive.
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
    {/* Emplacement fixe : sans lui, les libellés se décalent selon l'élément coché. */}
    <span className="flex w-4 shrink-0 items-center justify-center">
      <ContextMenuPrimitive.ItemIndicator>
        <Check size={13} />
      </ContextMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </ContextMenuPrimitive.RadioItem>
));
ContextMenuRadioItem.displayName = 'ContextMenuRadioItem';

// Sous-menus (gestion des rôles live par clic droit — retours 33).
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
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
};

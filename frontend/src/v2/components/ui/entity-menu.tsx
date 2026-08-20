// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef, type ReactNode } from 'react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from './context-menu';
import { isRadioGroup, isSeparator, isSubmenu, tidyMenu, type MenuEntry } from '../../lib/menuSpec';
import { useT } from '../../i18n';

/** Rend une liste d'entrées déclarées (`lib/menuSpec`) avec la primitive Radix. */
function MenuEntries({ entries }: { entries: MenuEntry[] }) {
  return (
    <>
      {entries.map((entry) => {
        if (isSeparator(entry)) return <ContextMenuSeparator key={entry.id} />;
        if (isRadioGroup(entry)) {
          return (
            <ContextMenuRadioGroup key={entry.id} value={entry.value} onValueChange={entry.onValueChange}>
              {entry.items.map((item) => (
                <ContextMenuRadioItem key={item.id} value={item.value} disabled={item.disabled}>
                  {item.icon}
                  {item.label}
                </ContextMenuRadioItem>
              ))}
            </ContextMenuRadioGroup>
          );
        }
        if (isSubmenu(entry)) {
          return (
            <ContextMenuSub key={entry.id}>
              <ContextMenuSubTrigger>
                {entry.icon}
                {entry.label}
              </ContextMenuSubTrigger>
              <ContextMenuSubContent>
                <MenuEntries entries={entry.items} />
              </ContextMenuSubContent>
            </ContextMenuSub>
          );
        }
        return (
          <ContextMenuItem
            key={entry.id}
            danger={entry.danger}
            disabled={entry.disabled}
            onClick={entry.onSelect}
          >
            {entry.icon}
            {entry.label}
            {entry.kbd != null && (
              <kbd className="ml-auto rounded border border-border bg-secondary/60 px-1.5 py-0.5 text-2xs font-medium text-muted-foreground">
                {entry.kbd}
              </kbd>
            )}
          </ContextMenuItem>
        );
      })}
    </>
  );
}

/**
 * Menu contextuel d'une entité (A3).
 *
 * Enveloppe un élément et lui attache le menu décrit par `entries`. Deux apports par
 * rapport à l'usage direct de la primitive :
 *
 * - **Clavier** : Radix n'ouvre pas ses menus contextuels au clavier. La touche Menu et
 *   Shift+F10 les ouvrent ici, sinon toute action réservée au clic droit serait hors
 *   d'atteinte de qui n'utilise pas la souris.
 * - **Imbrication** : un menu imbriqué dans un autre (widget dans une page, marqueur dans
 *   une barre de temps) doit arrêter la propagation, sans quoi les deux s'ouvrent. Le
 *   motif était recopié à la main à chaque fois ; `nested` s'en charge.
 */
export default function EntityContextMenu({
  entries,
  nested = false,
  children,
}: {
  entries: MenuEntry[];
  nested?: boolean;
  children: ReactNode;
}) {
  const t = useT();
  const hostRef = useRef<HTMLDivElement>(null);
  const tidy = tidyMenu(entries);

  // Écouteur natif plutôt que `onKeyDown` en JSX : le conteneur n'est pas lui-même
  // interactif (c'est son contenu qui l'est), lui coller un rôle ARIA serait mentir.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || tidy.length === 0) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'ContextMenu' && !(event.key === 'F10' && event.shiftKey)) return;
      event.preventDefault();
      const rect = host.getBoundingClientRect();
      host.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          clientX: rect.left + 8,
          clientY: rect.top + rect.height / 2,
        }),
      );
    };
    host.addEventListener('keydown', onKeyDown);
    return () => host.removeEventListener('keydown', onKeyDown);
  }, [tidy.length]);

  if (tidy.length === 0) return <>{children}</>;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={hostRef}
          onContextMenu={nested ? (e) => e.stopPropagation() : undefined}
          aria-label={t('ctx.menu')}
        >
          {children}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <MenuEntries entries={tidy} />
      </ContextMenuContent>
    </ContextMenu>
  );
}

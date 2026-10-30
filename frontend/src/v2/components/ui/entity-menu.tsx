// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef, type ReactNode } from 'react';
import {
  ContextMenu,
  ContextMenuCheckboxItem,
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
import {
  isCheckbox,
  isRadioGroup,
  isSeparator,
  isSubmenu,
  tidyMenu,
  type MenuEntry,
} from '../../lib/menuSpec';
import { useT } from '../../i18n';

/** Renders a list of declared entries (`lib/menuSpec`) with the Radix primitive. */
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
        if (isCheckbox(entry)) {
          return (
            <ContextMenuCheckboxItem
              key={entry.id}
              checked={entry.checked}
              disabled={entry.disabled}
              onCheckedChange={entry.onCheckedChange}
            >
              {entry.icon}
              {entry.label}
            </ContextMenuCheckboxItem>
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
 * Context menu for an entity (A3).
 *
 * Wraps an element and attaches the menu described by `entries`. Two additions compared
 * to using the primitive directly:
 *
 * - **Keyboard**: Radix does not open its context menus from the keyboard. The Menu key and
 *   Shift+F10 open them here, otherwise any action reserved for right click would be out of
 *   reach for anyone not using a mouse.
 * - **Nesting**: a menu nested inside another (widget in a page, marker in a timeline bar)
 *   must stop propagation, otherwise both open. The pattern was copied by hand each time;
 *   `nested` handles it.
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

  // Native listener rather than `onKeyDown` in JSX: the container is not itself interactive
  // (its content is), and giving it an ARIA role would be a lie.
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

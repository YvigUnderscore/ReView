// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useQueryClient } from '@tanstack/react-query';
import { Keyboard, Link2, Moon, PanelLeft, RefreshCw, Sun } from 'lucide-react';
import { toast } from 'sonner';
import { CommandGroup, CommandItem } from '../ui/command';
import { useTheme } from '../../stores/useTheme';
import { useT } from '../../i18n';
import { matchDestinations } from './paletteMatch';

/**
 * General actions of the palette (A3).
 *
 * They used to live in the right-click menu, which opened on any point of the screen and offered the same entries whatever
 * one was aiming at. Right-click is now reserved for domain menus; these actions, which apply to the whole page, belong
 * here: searchable, and reachable by keyboard.
 */
export default function PaletteActions({
  query,
  onRun,
  onShortcuts,
  onToggleSidebar,
}: {
  /** Current input: the actions stay searchable instead of disappearing as one types. */
  query: string;
  /** Closes the palette before running the action. */
  onRun: (action: () => void) => void;
  onShortcuts: () => void;
  onToggleSidebar: () => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const theme = useTheme((s) => s.theme);
  const toggleTheme = useTheme((s) => s.toggle);

  const copyPageLink = () => {
    void navigator.clipboard
      .writeText(window.location.href)
      .then(() => toast.success(t('comments.linkCopied')))
      .catch(() => toast.error(t('common.error.generic')));
  };

  const actions = [
    {
      key: 'copy-link',
      label: t('gctx.copyPageLink'),
      icon: <Link2 size={15} className="text-muted-foreground" />,
      run: copyPageLink,
    },
    {
      key: 'refresh',
      label: t('gctx.refreshData'),
      icon: <RefreshCw size={15} className="text-muted-foreground" />,
      // Targeted at the queries actually mounted: the old menu invalidated the whole cache, including the screens one
      // was not looking at.
      run: () => void qc.invalidateQueries({ type: 'active' }),
    },
    {
      key: 'sidebar',
      label: t('gctx.toggleSidebar'),
      icon: <PanelLeft size={15} className="text-muted-foreground" />,
      run: onToggleSidebar,
    },
    {
      key: 'theme',
      label: theme === 'dark' ? t('gctx.lightTheme') : t('gctx.darkTheme'),
      icon:
        theme === 'dark' ? (
          <Sun size={15} className="text-muted-foreground" />
        ) : (
          <Moon size={15} className="text-muted-foreground" />
        ),
      run: toggleTheme,
    },
    {
      key: 'shortcuts',
      label: t('gctx.shortcuts'),
      icon: <Keyboard size={15} className="text-muted-foreground" />,
      run: onShortcuts,
    },
  ];

  const shown = matchDestinations(actions, query);
  if (shown.length === 0) return null;

  return (
    <CommandGroup heading={t('palette.group.actions')}>
      {shown.map((action) => (
        <CommandItem key={action.key} value={`action-${action.key}`} onSelect={() => onRun(action.run)}>
          {action.icon} {action.label}
        </CommandItem>
      ))}
    </CommandGroup>
  );
}

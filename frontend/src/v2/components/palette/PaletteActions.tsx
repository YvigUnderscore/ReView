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
 * Actions générales de la palette (A3).
 *
 * Elles vivaient dans le menu du clic droit, qui s'ouvrait sur n'importe quel point de
 * l'écran et proposait les mêmes entrées quel que soit ce qu'on visait. Le clic droit est
 * désormais réservé aux menus métier ; ces actions-là, qui portent sur la page entière,
 * sont à leur place ici — cherchables, et accessibles au clavier.
 */
export default function PaletteActions({
  query,
  onRun,
  onShortcuts,
  onToggleSidebar,
}: {
  /** Saisie courante : les actions restent cherchables au lieu de disparaître à la frappe. */
  query: string;
  /** Ferme la palette avant d'exécuter l'action. */
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
      // Ciblé sur les requêtes réellement montées : l'ancien menu invalidait tout le
      // cache, y compris les écrans que l'on ne regardait pas.
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

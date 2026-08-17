// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useQueryClient } from '@tanstack/react-query';
import { Keyboard, Link2, Moon, PanelLeft, RefreshCw, Sun } from 'lucide-react';
import { toast } from 'sonner';
import { CommandGroup, CommandItem } from '../ui/command';
import { useTheme } from '../../stores/useTheme';
import { useT } from '../../i18n';

/**
 * Actions générales de la palette (A3).
 *
 * Elles vivaient dans le menu du clic droit, qui s'ouvrait sur n'importe quel point de
 * l'écran et proposait les mêmes entrées quel que soit ce qu'on visait. Le clic droit est
 * désormais réservé aux menus métier ; ces actions-là, qui portent sur la page entière,
 * sont à leur place ici — cherchables, et accessibles au clavier.
 */
export default function PaletteActions({
  onRun,
  onShortcuts,
  onToggleSidebar,
}: {
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

  return (
    <CommandGroup heading={t('palette.group.actions')}>
      <CommandItem value="action-copy-link" onSelect={() => onRun(copyPageLink)}>
        <Link2 size={15} className="text-muted-foreground" /> {t('gctx.copyPageLink')}
      </CommandItem>
      <CommandItem
        value="action-refresh"
        onSelect={() =>
          onRun(() => {
            // Ciblé sur les requêtes réellement montées : l'ancien menu invalidait tout le
            // cache, y compris les écrans que l'on ne regardait pas.
            void qc.invalidateQueries({ type: 'active' });
          })
        }
      >
        <RefreshCw size={15} className="text-muted-foreground" /> {t('gctx.refreshData')}
      </CommandItem>
      <CommandItem value="action-sidebar" onSelect={() => onRun(onToggleSidebar)}>
        <PanelLeft size={15} className="text-muted-foreground" /> {t('gctx.toggleSidebar')}
      </CommandItem>
      <CommandItem value="action-theme" onSelect={() => onRun(toggleTheme)}>
        {theme === 'dark' ? (
          <Sun size={15} className="text-muted-foreground" />
        ) : (
          <Moon size={15} className="text-muted-foreground" />
        )}
        {theme === 'dark' ? t('gctx.lightTheme') : t('gctx.darkTheme')}
      </CommandItem>
      <CommandItem value="action-shortcuts" onSelect={() => onRun(onShortcuts)}>
        <Keyboard size={15} className="text-muted-foreground" /> {t('gctx.shortcuts')}
      </CommandItem>
    </CommandGroup>
  );
}

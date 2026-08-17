// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowRight,
  Copy,
  Download,
  ExternalLink,
  Keyboard,
  Link2,
  Moon,
  PanelLeft,
  RefreshCw,
  Search,
  Sun,
} from 'lucide-react';
import { toast } from 'sonner';
import { Popover, PopoverAnchor, PopoverContent } from './ui/popover';
import { useTheme } from '../stores/useTheme';
import { copyImageToClipboard, downloadImage } from '../pages/review/mediaCapture';
import { useT } from '../i18n';

/**
 * Clic droit global (chantier « clic droit partout ») : le menu natif du navigateur est
 * remplacé sur toute l'app par un menu de repli contextuel — sauf trois échappatoires :
 * - Shift+clic droit rouvre toujours le menu natif (convention Figma/Maps, dépannage) ;
 * - les champs de saisie gardent le natif (couper/coller, correcteur, dictée) ;
 * - un élément qui a déjà traité l'événement (menus Radix, viewers 3D/splat qui orbitent)
 *   est détecté via `defaultPrevented` : le repli ne se superpose jamais à un menu métier.
 * Le menu s'adapte à la cible : lien, image, sélection de texte, sinon page.
 */

/** Sélecteur des cibles où le menu natif reste roi (édition de texte). */
const NATIVE_ZONES = 'input, textarea, select, [contenteditable="true"], [contenteditable="plaintext-only"]';

interface Ctx {
  x: number;
  y: number;
  /** Lien englobant (`<a href>`), s'il y en a un. */
  href: string | null;
  /** Image cliquée (`<img src>`), s'il y en a une. */
  imgSrc: string | null;
  /** Texte sélectionné au moment du clic. */
  selection: string;
}

function Item({
  icon,
  label,
  kbd,
  onSelect,
}: {
  icon: React.ReactNode;
  label: string;
  kbd?: string;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className="flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-foreground outline-none transition-colors hover:bg-secondary focus:bg-secondary"
    >
      {icon}
      {label}
      {kbd && (
        <kbd className="ml-auto rounded border border-border bg-secondary/60 px-1.5 py-0.5 text-2xs font-medium text-muted-foreground">
          {kbd}
        </kbd>
      )}
    </button>
  );
}

const Sep = () => <div className="my-1 h-px bg-border" />;

export default function GlobalContextMenu({
  onSearch,
  onShortcuts,
  onToggleSidebar,
}: {
  onSearch: () => void;
  onShortcuts: () => void;
  onToggleSidebar: () => void;
}) {
  const t = useT();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const theme = useTheme((s) => s.theme);
  const toggleTheme = useTheme((s) => s.toggle);
  const [ctx, setCtx] = useState<Ctx | null>(null);

  useEffect(() => {
    const onContextMenu = (e: MouseEvent) => {
      // Un composant (menu Radix, viewer 3D) a déjà pris l'événement : on s'efface.
      if (e.defaultPrevented) return;
      // Échappatoire : Shift+clic droit = menu natif du navigateur.
      if (e.shiftKey) return;
      const target = e.target as HTMLElement | null;
      if (!target || target.closest(NATIVE_ZONES)) return;
      e.preventDefault();
      // `closest` ne rend qu'un `Element` : on re-restreint aux types qui portent `href`/`src`.
      const a = target.closest('a[href]');
      const img = target.closest('img[src]');
      setCtx({
        x: e.clientX,
        y: e.clientY,
        href: a instanceof HTMLAnchorElement ? a.href : null,
        imgSrc: img instanceof HTMLImageElement ? img.src : null,
        selection: window.getSelection()?.toString().trim() ?? '',
      });
    };
    document.addEventListener('contextmenu', onContextMenu);
    return () => document.removeEventListener('contextmenu', onContextMenu);
  }, []);

  if (!ctx) return null;

  const close = () => setCtx(null);
  const run = (fn: () => void) => () => {
    close();
    fn();
  };
  const runAsync = (label: string, fn: () => Promise<void>) => () => {
    close();
    void fn()
      .then(() => toast.success(label))
      .catch((e: unknown) =>
        toast.error(e instanceof Error ? e.message : t('ctx.actionFailed', { action: label })),
      );
  };

  return (
    <Popover open onOpenChange={(o) => !o && close()}>
      <PopoverAnchor asChild>
        <span style={{ position: 'fixed', left: ctx.x, top: ctx.y, width: 0, height: 0 }} />
      </PopoverAnchor>
      <PopoverContent align="start" sideOffset={2} className="w-56 p-1">
        {ctx.href && (
          <>
            <Item
              icon={<ArrowRight size={14} />}
              label={t('gctx.openLink')}
              onSelect={run(() => {
                const url = new URL(ctx.href!, window.location.origin);
                if (url.origin === window.location.origin)
                  void navigate(url.pathname + url.search + url.hash);
                else window.open(url.href, '_blank', 'noopener');
              })}
            />
            <Item
              icon={<ExternalLink size={14} />}
              label={t('gctx.openLinkNewTab')}
              onSelect={run(() => window.open(ctx.href!, '_blank', 'noopener'))}
            />
            <Item
              icon={<Link2 size={14} />}
              label={t('gctx.copyLink')}
              onSelect={runAsync(t('comments.linkCopied'), () => navigator.clipboard.writeText(ctx.href!))}
            />
            <Sep />
          </>
        )}
        {ctx.imgSrc && (
          <>
            <Item
              icon={<Copy size={14} />}
              label={t('ctx.copyImage')}
              onSelect={runAsync(t('ctx.imageCopied'), () => copyImageToClipboard(ctx.imgSrc!))}
            />
            <Item
              icon={<Download size={14} />}
              label={t('gctx.downloadImage')}
              onSelect={runAsync(t('ctx.imageDownloaded'), () =>
                downloadImage(ctx.imgSrc!, ctx.imgSrc!.split('/').pop()?.split('?')[0] || 'image'),
              )}
            />
            <Sep />
          </>
        )}
        {ctx.selection && (
          <>
            <Item
              icon={<Copy size={14} />}
              label={t('gctx.copySelection')}
              onSelect={runAsync(t('gctx.selectionCopied'), () =>
                navigator.clipboard.writeText(ctx.selection),
              )}
            />
            <Sep />
          </>
        )}
        <Item
          icon={<ArrowLeft size={14} />}
          label={t('gctx.back')}
          onSelect={run(() => {
            void navigate(-1);
          })}
        />
        <Item
          icon={<ArrowRight size={14} />}
          label={t('gctx.forward')}
          onSelect={run(() => {
            void navigate(1);
          })}
        />
        <Item
          icon={<RefreshCw size={14} />}
          label={t('gctx.refreshData')}
          onSelect={run(() => void qc.invalidateQueries())}
        />
        <Sep />
        <Item icon={<Search size={14} />} label={t('gctx.search')} kbd="Ctrl K" onSelect={run(onSearch)} />
        <Item
          icon={<Link2 size={14} />}
          label={t('gctx.copyPageLink')}
          onSelect={runAsync(t('comments.linkCopied'), () =>
            navigator.clipboard.writeText(window.location.href),
          )}
        />
        <Sep />
        <Item
          icon={<PanelLeft size={14} />}
          label={t('gctx.toggleSidebar')}
          onSelect={run(onToggleSidebar)}
        />
        <Item
          icon={theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
          label={theme === 'dark' ? t('gctx.lightTheme') : t('gctx.darkTheme')}
          onSelect={run(toggleTheme)}
        />
        <Item icon={<Keyboard size={14} />} label={t('gctx.shortcuts')} onSelect={run(onShortcuts)} />
      </PopoverContent>
    </Popover>
  );
}

// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { MoreHorizontal } from 'lucide-react';
import { DURATION } from '../lib/motion';
import { computeVisibleTabs, splitTabs } from '../lib/tabsOverflow';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { useT } from '../i18n';

export interface TabDef {
  key: string;
  label: string;
  icon?: ReactNode;
  badge?: number;
}

/** Gouttière réelle entre onglets (`gap-1` = 0.25rem à la taille de police racine). */
const GAP_PX = 4;

const TAB_CLASS =
  'relative flex shrink-0 items-center gap-2 whitespace-nowrap px-3 py-2 text-sm transition-colors';
const MORE_CLASS =
  'flex shrink-0 items-center rounded-md px-2 py-2 text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground';

function TabButton({
  tab,
  isActive,
  onClick,
  showUnderline,
}: {
  tab: TabDef;
  isActive: boolean;
  onClick?: () => void;
  /** Faux dans le bloc de mesure : deux `layoutId` identiques casseraient l'animation. */
  showUnderline: boolean;
}) {
  return (
    <button
      onClick={onClick}
      tabIndex={showUnderline ? undefined : -1}
      className={`${TAB_CLASS} ${isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
    >
      {tab.icon}
      {tab.label}
      {tab.badge != null && tab.badge > 0 && (
        <span className="rounded-full bg-secondary px-1.5 text-xs text-muted-foreground">{tab.badge}</span>
      )}
      {isActive && showUnderline && (
        <motion.div
          layoutId="tab-underline"
          className="absolute inset-x-0 -bottom-px h-0.5 bg-primary"
          transition={{ duration: DURATION.base }}
        />
      )}
    </button>
  );
}

/**
 * Barre d'onglets à débordement (A1) : ce qui ne tient pas part dans un menu « … »,
 * l'onglet actif restant toujours visible. Aucun défilement horizontal — la page projet
 * peut porter onze onglets et rester utilisable dans une fenêtre de 900 px.
 */
export default function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: TabDef[];
  active: string;
  onChange: (key: string) => void;
}) {
  const t = useT();
  const barRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(tabs.length);
  const [menuOpen, setMenuOpen] = useState(false);

  // Signature plutôt que le tableau : les appelants le reconstruisent à chaque rendu,
  // et réabonner un ResizeObserver soixante fois par seconde ne sert à rien.
  const signature = tabs.map((tab) => `${tab.key}|${tab.label}|${tab.badge ?? ''}`).join('§');

  useLayoutEffect(() => {
    const bar = barRef.current;
    const measure = measureRef.current;
    if (!bar || !measure) return;
    const recompute = () => {
      const nodes = Array.from(measure.children) as HTMLElement[];
      const widths = nodes.slice(0, -1).map((node) => node.offsetWidth);
      const moreWidth = nodes[nodes.length - 1]?.offsetWidth ?? 0;
      setVisibleCount(computeVisibleTabs(widths, GAP_PX, bar.clientWidth, moreWidth));
    };
    recompute();
    const observer = new ResizeObserver(recompute);
    observer.observe(bar);
    return () => observer.disconnect();
  }, [signature]);

  const activeIndex = tabs.findIndex((tab) => tab.key === active);
  const { visible, overflow } = splitTabs(tabs, visibleCount, activeIndex);

  return (
    <div className="relative mb-5 border-b border-border">
      {/* Mesure hors écran : largeur naturelle des onglets, sans contrainte du conteneur.
          Placé à gauche du viewport, il ne peut pas provoquer de défilement. */}
      <div
        ref={measureRef}
        aria-hidden
        className="pointer-events-none fixed left-[-99999px] top-0 flex gap-1"
      >
        {tabs.map((tab) => (
          <TabButton key={tab.key} tab={tab} isActive={false} showUnderline={false} />
        ))}
        <span className={MORE_CLASS}>
          <MoreHorizontal size={16} />
        </span>
      </div>

      <div ref={barRef} className="flex items-center gap-1">
        {visible.map((tab) => (
          <TabButton
            key={tab.key}
            tab={tab}
            isActive={tab.key === active}
            onClick={() => onChange(tab.key)}
            showUnderline
          />
        ))}
        {overflow.length > 0 && (
          <Popover open={menuOpen} onOpenChange={setMenuOpen}>
            <PopoverTrigger asChild>
              <button className={MORE_CLASS} title={t('tabs.more')} aria-label={t('tabs.more')}>
                <MoreHorizontal size={16} />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-56">
              {overflow.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => {
                    setMenuOpen(false);
                    onChange(tab.key);
                  }}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                >
                  {tab.icon}
                  <span className="flex-1 truncate">{tab.label}</span>
                  {tab.badge != null && tab.badge > 0 && (
                    <span className="rounded-full bg-secondary px-1.5 text-xs">{tab.badge}</span>
                  )}
                </button>
              ))}
            </PopoverContent>
          </Popover>
        )}
      </div>
    </div>
  );
}

// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { computeVisibleTabs, splitTabs } from '../lib/tabsOverflow';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { useT } from '../i18n';

export interface TabDef {
  key: string;
  label: string;
  icon?: ReactNode;
  badge?: number;
}

/** Real gutter between tabs (`gap-1` = 0.25rem at the root font size). */
const GAP_PX = 4;

const TAB_CLASS =
  'relative flex shrink-0 items-center gap-2 whitespace-nowrap px-3 py-2 text-sm transition-colors';
const MORE_CLASS =
  'flex shrink-0 items-center rounded-md px-2 py-2 text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground';

function TabButton({
  tab,
  isActive,
  onClick,
  measuring,
}: {
  tab: TabDef;
  isActive: boolean;
  onClick?: () => void;
  /** True in the off-screen measuring block: neither tabbable nor a target for the underline. */
  measuring: boolean;
}) {
  return (
    <button
      type="button"
      // Without `role="tab"` or `aria-selected`, nothing told the screen reader that these
      // buttons formed a set of tabs, nor which one was active: one heard four
      // interchangeable buttons. The jsx-a11y rule cannot catch it, since a bare `<button>`
      // is perfectly valid; it is the PATTERN that was incomplete.
      role="tab"
      aria-selected={isActive}
      onClick={onClick}
      tabIndex={measuring ? -1 : undefined}
      // Target for measuring the underline: the off-screen block carries none, otherwise
      // it would be found first.
      data-tab={measuring ? undefined : tab.key}
      className={`${TAB_CLASS} ${isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
    >
      {tab.icon}
      {tab.label}
      {tab.badge != null && tab.badge > 0 && (
        <span className="rounded-full bg-secondary px-1.5 text-xs text-muted-foreground">{tab.badge}</span>
      )}
    </button>
  );
}

/**
 * Overflowing tab bar (A1): what does not fit goes into a "…" menu,
 * the active tab always remaining visible. No horizontal scrolling: the project page
 * can carry eleven tabs and remain usable in a 900 px window.
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
  // Underline of the active tab: a single node moved by a CSS transition, where
  // framer-motion used to slide a `layoutId` (F3). Its position is a DOM measurement,
  // written directly into the style: passing it through state would re-run a full render
  // of the bar at each tab change.
  const underlineRef = useRef<HTMLSpanElement>(null);
  const placed = useRef(false);
  const [visibleCount, setVisibleCount] = useState(tabs.length);
  const [menuOpen, setMenuOpen] = useState(false);

  // Signature rather than the array: callers rebuild it at each render, and
  // re-subscribing a ResizeObserver sixty times per second serves no purpose.
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

  useLayoutEffect(() => {
    const bar = barRef.current;
    const line = underlineRef.current;
    if (!bar || !line) return;
    const place = () => {
      const node = Array.from(bar.children).find(
        (el): el is HTMLElement => el instanceof HTMLElement && el.dataset.tab === active,
      );
      if (!node) {
        line.style.opacity = '0';
        return;
      }
      // First placement without transition: otherwise the bar would arrive sliding from
      // the left edge on mount, which the layout animation did not do.
      if (!placed.current) line.style.transition = 'none';
      line.style.opacity = '1';
      line.style.width = `${node.offsetWidth}px`;
      line.style.transform = `translateX(${node.offsetLeft}px)`;
      if (!placed.current) {
        void line.offsetWidth; // force le recalcul avant de réarmer la transition
        line.style.transition = '';
        placed.current = true;
      }
    };
    place();
  }, [active, visibleCount, signature]);

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
          <TabButton key={tab.key} tab={tab} isActive={false} measuring />
        ))}
        <span className={MORE_CLASS}>
          <MoreHorizontal size={16} />
        </span>
      </div>

      <div ref={barRef} role="tablist" className="relative flex items-center gap-1">
        {visible.map((tab) => (
          <TabButton
            key={tab.key}
            tab={tab}
            isActive={tab.key === active}
            onClick={() => onChange(tab.key)}
            measuring={false}
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
        <span
          ref={underlineRef}
          aria-hidden
          className="pointer-events-none absolute -bottom-px left-0 h-0.5 w-0 bg-primary opacity-0 transition-[transform,width] duration-200 ease-out motion-reduce:transition-none"
        />
      </div>
    </div>
  );
}

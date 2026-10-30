// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  cloneElement,
  isValidElement,
  useEffect,
  useReducer,
  type ReactElement,
  type ReactNode,
} from 'react';
import { shouldRenderTooltip } from './tooltip.variants';

/**
 * Tooltip facade — the only thing components import.
 *
 * ## Why a facade
 *
 * Radix Tooltip weighs ~10 kB gzip. Imported by `IconButton`, which sits on the entry path,
 * it entered the **first load**: 429.8 kB for a budget of 430.0, i.e. 0.2 kB of margin — the
 * next change, whatever it was, would have failed the suite. Yet a tooltip is by definition
 * useless on the first render: nobody hovers a button that has not been painted yet.
 *
 * This module therefore contains no Radix code. It renders the child as is, requests the real
 * module as soon as the browser is idle, and switches over when it arrives. In between, the
 * native `title` attribute fills the role: that is what was there before, it is not a
 * regression, and it lasts only for the duration of a chunk load.
 *
 * ## What is lost, and why it is the right trade-off
 *
 * Radix's provider remembers the **grace window** — sweeping a dense bar without paying the
 * delay on every icon. Mounting it at the root would require having it from the first render
 * (hence in the entry chunk: going round in circles), or inserting it later above the
 * application, which would **remount it entirely**. Each tooltip therefore supplies its own
 * provider, with the same delays. The shared grace is lost: hovering the second icon of a bar
 * costs 250 ms. We remain six times faster than the native `title` we replace, without weighing
 * on the first screen of every visitor.
 */

type Module = typeof import('./tooltip.radix');

let chargee: Module | null = null;
let enCours: Promise<Module> | null = null;
const abonnes = new Set<() => void>();

/** A single request for the whole application, however many tooltips there are. */
function demander(): Promise<Module> {
  enCours ??= import('./tooltip.radix').then((m) => {
    chargee = m;
    // Copy: a subscriber unsubscribing during the broadcast must not shift the iteration.
    for (const prevenir of [...abonnes]) prevenir();
    return m;
  });
  return enCours;
}

/** `requestIdleCallback` is still missing in Safari: the fallback need not be precise, just late. */
function quandLibre(tache: () => void): () => void {
  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(tache, { timeout: 2_000 });
    return () => cancelIdleCallback(id);
  }
  const id = setTimeout(tache, 400);
  return () => clearTimeout(id);
}

function useModuleInfobulle(): Module | null {
  const [, redessiner] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (chargee) return;
    abonnes.add(redessiner);
    const annuler = quandLibre(() => void demander());
    return () => {
      abonnes.delete(redessiner);
      annuler();
    };
  }, []);
  return chargee;
}

/**
 * Wraps an already named control. An empty `label` renders nothing: callers can pass an
 * optional value without guarding it themselves.
 */
export function Tooltip({
  label,
  side,
  children,
}: {
  label?: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  children: ReactNode;
}) {
  const module = useModuleInfobulle();
  if (!shouldRenderTooltip(label)) return <>{children}</>;

  if (!module) {
    // Fallback while loading. `title` only accepts a string: a rich label (rare) has no
    // fallback, and had none before this primitive either.
    return typeof label === 'string' && isValidElement(children) ? (
      cloneElement(children as ReactElement<{ title?: string }>, { title: label })
    ) : (
      <>{children}</>
    );
  }

  const { RadixTooltip } = module;
  return (
    <RadixTooltip label={label} side={side}>
      {children}
    </RadixTooltip>
  );
}

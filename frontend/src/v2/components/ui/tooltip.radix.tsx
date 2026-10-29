// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  createContext,
  forwardRef,
  useContext,
  type ComponentPropsWithoutRef,
  type ComponentRef,
  type ReactNode,
} from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import {
  TOOLTIP_DELAY_MS,
  TOOLTIP_SKIP_DELAY_MS,
  shouldRenderTooltip,
  tooltipContentClass,
} from './tooltip.variants';

/**
 * Accessible tooltip (Radix): portal, automatic positioning, close on Escape,
 * opens on hover **and on keyboard focus**. It replaces the native `title` attribute, which
 * waits ~1.5 s, cannot be styled, ignores the theme and never appears on the keyboard.
 *
 * ## It does not name the control — it describes it
 *
 * Do not confuse the two: Radix sets `aria-describedby` on the trigger, not
 * `aria-labelledby`. A tooltip is therefore **never** a substitute for the accessible name.
 * An icon-only button keeps its `aria-label`: that is what the screen reader announces, and
 * it is the only information that survives on touch, where no tooltip opens (neither the
 * native one nor this one).
 *
 * Accepted trade-off when the tooltip repeats the `aria-label` word for word (the case of
 * `IconButton`): on opening, the screen reader announces the name then the description, so
 * the same word twice. This is what everyone does (shadcn, Radix), and it is the lesser evil —
 * removing the `aria-label` would leave the button anonymous on touch and for any reader
 * that does not open the tooltip.
 */
const TooltipRoot = TooltipPrimitive.Root;
const TooltipTrigger = TooltipPrimitive.Trigger;

/**
 * Provider presence marker.
 *
 * Radix **throws** when a `Tooltip` has no provider above it, and a render exception cannot
 * be caught locally: it bubbles to the nearest `ErrorBoundary` and empties the whole subtree.
 * An icon button mounted in a React root on its own would therefore make the page around it
 * disappear. Too much damage for a decoration.
 *
 * Hence this context, which exists only to answer "is there a provider?" — a question that
 * Radix's own context, not exported, cannot answer. When the answer is no, `Tooltip` supplies
 * its own: we lose the shared grace window, never the display.
 */
const HasTooltipProvider = createContext(false);

/**
 * A single provider, mounted high in the tree (see `App.tsx`).
 *
 * Mounting one per button would cost one context per button **and** lose the grace window:
 * it is the provider that remembers it, so it is what lets a dense bar be swept without
 * paying the delay on every icon. Both settings are therefore held here, once.
 */
function TooltipProvider({
  delayDuration = TOOLTIP_DELAY_MS,
  skipDelayDuration = TOOLTIP_SKIP_DELAY_MS,
  ...props
}: ComponentPropsWithoutRef<typeof TooltipPrimitive.Provider>) {
  return (
    <HasTooltipProvider.Provider value={true}>
      <TooltipPrimitive.Provider
        delayDuration={delayDuration}
        skipDelayDuration={skipDelayDuration}
        {...props}
      />
    </HasTooltipProvider.Provider>
  );
}

const TooltipContent = forwardRef<
  ComponentRef<typeof TooltipPrimitive.Content>,
  ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 6, collisionPadding = 8, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      collisionPadding={collisionPadding}
      className={tooltipContentClass(className)}
      {...props}
    />
  </TooltipPrimitive.Portal>
));
TooltipContent.displayName = 'TooltipContent';

/**
 * Shortcut for the common case: wrapping an already named control.
 *
 * `asChild` on the trigger — the tooltip must not introduce an extra tag around the button:
 * it would break `flex` bars and neighbour selectors. An empty `label` renders nothing at all,
 * so callers can pass an optional value without guarding it themselves.
 */
export function RadixTooltip({
  label,
  side,
  children,
}: {
  label?: ReactNode;
  side?: ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>['side'];
  children: ReactNode;
}) {
  const hasProvider = useContext(HasTooltipProvider);
  if (!shouldRenderTooltip(label)) return <>{children}</>;
  const tooltip = (
    <TooltipRoot>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side}>{label}</TooltipContent>
    </TooltipRoot>
  );
  // Isolated fallback: a lost grace window is better than an erased subtree.
  return hasProvider ? tooltip : <TooltipProvider>{tooltip}</TooltipProvider>;
}

export { TooltipProvider, TooltipRoot, TooltipTrigger, TooltipContent };

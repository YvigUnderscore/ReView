// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { cva, type VariantProps } from 'class-variance-authority';

/**
 * Button variants, isolated from the component so they can be checked without rendering
 * (same split as `card.variants.ts`).
 *
 * Two rules hold this file together, and the tests lock them in:
 *
 *  1. **A variant without a fill is read by its border.** `outline` has no background: its
 *     line is the only thing that says there is a button, so it is a control boundary in
 *     the sense of WCAG 1.4.11 (3:1 against the surface) and it takes `border-strong`.
 *     `--border`, the decorative line used for separators, left it at 1.37:1 in light theme
 *     and 1.17:1 in dark: on a card the button had no visible outline.
 *  2. **Every hover state has its pressed state.** `active:` pushes the fill one step
 *     further than `hover:`, otherwise pressing is indistinguishable from hovering. The
 *     geometric press effect common to all controls comes from `ui-pressable` (see
 *     index.css): it does not depend on the variant, so it is written only once, in the base.
 */
export const buttonVariants = cva(
  'ui-pressable inline-flex items-center justify-center gap-1.5 rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80',
        destructive:
          'bg-destructive text-destructive-foreground hover:bg-destructive/90 active:bg-destructive/80',
        outline:
          'border border-border-strong bg-transparent hover:bg-secondary/60 hover:text-foreground active:bg-secondary',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80 active:bg-secondary/60',
        ghost: 'hover:bg-secondary/60 hover:text-foreground active:bg-secondary',
        link: 'text-primary underline-offset-4 hover:underline active:text-primary/80',
      },
      size: {
        default: 'px-4 py-2',
        sm: 'px-3 py-1.5 text-xs',
        lg: 'px-6 py-2.5 text-base',
        icon: 'h-8 w-8 p-0',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export type ButtonVariants = VariantProps<typeof buttonVariants>;

// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { cva, type VariantProps } from 'class-variance-authority';

/**
 * Card variants, isolated from the component so they can be checked without rendering.
 *
 * The scale does not come from shadcn (its `p-6` appears nowhere here) but from a survey
 * of the surfaces actually drawn in the app: a settings or statistics panel is
 * `rounded-lg … p-4` (by far the most frequent pattern), a list row is `rounded-md … px-3 py-2`.
 * `variant` sets the shape, `padding` the density, and the two combine: a panel and a row
 * do not dose their margin the same way (uniform for one, horizontal for the other), hence
 * the combinations below rather than a single scale that would suit neither well.
 */
export const cardVariants = cva('border border-border bg-card text-card-foreground', {
  variants: {
    /** Panel laid on the page, or compact row/block inside a list. */
    variant: { panel: 'rounded-lg', row: 'rounded-md' },
    /** `none` leaves the spacing to the sub-components (`CardHeader`, `CardContent`). */
    padding: { none: '', sm: '', md: '', lg: '' },
    /** Clickable card: the border responds to hover. */
    interactive: { true: 'transition-colors hover:border-primary', false: '' },
  },
  compoundVariants: [
    { variant: 'panel', padding: 'sm', class: 'p-3' },
    { variant: 'panel', padding: 'md', class: 'p-4' },
    { variant: 'panel', padding: 'lg', class: 'p-5' },
    { variant: 'row', padding: 'sm', class: 'px-3 py-1.5' },
    { variant: 'row', padding: 'md', class: 'px-3 py-2' },
    { variant: 'row', padding: 'lg', class: 'px-4 py-3' },
  ],
  defaultVariants: { variant: 'panel', padding: 'md', interactive: false },
});

export type CardVariants = VariantProps<typeof cardVariants>;

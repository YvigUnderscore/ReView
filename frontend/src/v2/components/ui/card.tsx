// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { type HTMLAttributes, forwardRef } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cn } from '../../lib/utils';
import { cardVariants, type CardVariants } from './card.variants';

export interface CardProps extends HTMLAttributes<HTMLDivElement>, CardVariants {
  /**
   * Render the card on the child element rather than a `<div>`: essential when the surface
   * is also a link (`<Link>`) or a button, since the card cannot then wrap the element
   * without changing the clickable area.
   */
  asChild?: boolean;
}

/**
 * The surface laid on the page background: settings panel, statistics block, list row,
 * clickable tile. See `card.variants.ts` for the scale chosen.
 */
const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant, padding, interactive, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'div';
    return (
      <Comp ref={ref} className={cn(cardVariants({ variant, padding, interactive, className }))} {...props} />
    );
  },
);
Card.displayName = 'Card';

/**
 * Header and footer carry the spacing when the card is `padding="none"`: this is shadcn's
 * layout, brought down to the app's `p-4`.
 */
const CardHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-col gap-1 p-4', className)} {...props} />
  ),
);
CardHeader.displayName = 'CardHeader';

/**
 * Card title. `text-sm font-medium` rather than shadcn's `text-lg`: that is the weight all
 * existing panels use, and a panel title should not weigh more than the content it
 * announces. It has no spacing of its own, so it can be used as is in an already padded card.
 */
const CardTitle = forwardRef<HTMLParagraphElement, HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    // Generic primitive: the heading content comes from the caller through `{...props}`
    // (`children`), which the rule cannot see at this point.
    // eslint-disable-next-line jsx-a11y/heading-has-content
    <h3 ref={ref} className={cn('text-sm font-medium', className)} {...props} />
  ),
);
CardTitle.displayName = 'CardTitle';

/** The intent sentence under the title: `text-xs`, as in all the settings. */
const CardDescription = forwardRef<HTMLParagraphElement, HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn('text-xs text-muted-foreground', className)} {...props} />
  ),
);
CardDescription.displayName = 'CardDescription';

const CardContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn('p-4 pt-0', className)} {...props} />,
);
CardContent.displayName = 'CardContent';

const CardFooter = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex items-center p-4 pt-0', className)} {...props} />
  ),
);
CardFooter.displayName = 'CardFooter';

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter };

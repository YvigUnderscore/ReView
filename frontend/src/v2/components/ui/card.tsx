// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { type HTMLAttributes, forwardRef } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cn } from '../../lib/utils';
import { cardVariants, type CardVariants } from './card.variants';

export interface CardProps extends HTMLAttributes<HTMLDivElement>, CardVariants {
  /**
   * Rendre la carte sur l'élément enfant plutôt que sur un `<div>` : indispensable quand
   * la surface est aussi un lien (`<Link>`) ou un bouton, la carte ne pouvant alors pas
   * envelopper l'élément sans changer la zone cliquable.
   */
  asChild?: boolean;
}

/**
 * La surface posée sur le fond de page : panneau de réglages, bloc de statistiques,
 * ligne de liste, tuile cliquable. Voir `card.variants.ts` pour l'échelle retenue.
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
 * En-tête et pied portent l'espacement quand la carte est en `padding="none"` — c'est le
 * découpage de shadcn, ramené au `p-4` de l'application.
 */
const CardHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-col gap-1 p-4', className)} {...props} />
  ),
);
CardHeader.displayName = 'CardHeader';

/**
 * Titre de carte. `text-sm font-medium` et non le `text-lg` de shadcn : c'est la graisse
 * qu'emploient tous les panneaux existants, et un titre de panneau n'a pas à peser plus
 * lourd que le contenu qu'il annonce. Sans espacement propre, donc utilisable tel quel
 * dans une carte déjà rembourrée.
 */
const CardTitle = forwardRef<HTMLParagraphElement, HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    // Primitive générique : le contenu du titre arrive de l'appelant par `{...props}`
    // (`children`), la règle ne peut pas le voir à cet endroit.
    // eslint-disable-next-line jsx-a11y/heading-has-content
    <h3 ref={ref} className={cn('text-sm font-medium', className)} {...props} />
  ),
);
CardTitle.displayName = 'CardTitle';

/** La phrase d'intention sous le titre — `text-xs`, comme partout dans les réglages. */
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

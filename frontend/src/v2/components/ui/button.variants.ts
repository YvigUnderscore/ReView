// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { cva, type VariantProps } from 'class-variance-authority';

/**
 * Les variantes du bouton, isolées du composant pour être vérifiables sans rendu (même
 * découpage que `card.variants.ts`).
 *
 * Deux règles tiennent ce fichier, et les tests les verrouillent :
 *
 *  1. **Une variante sans aplat se lit par sa bordure.** `outline` n'a pas de fond : son
 *     trait est la seule chose qui dit qu'il y a un bouton, c'est donc une limite de
 *     contrôle au sens de WCAG 1.4.11 (3:1 avec la surface) et il prend `border-strong`.
 *     `--border`, le trait décoratif des séparateurs, le laissait à 1,37:1 en thème clair
 *     et 1,17:1 en sombre : sur une carte, le bouton n'avait pas de contour visible.
 *  2. **Tout état de survol a son état enfoncé.** `active:` pousse l'aplat un cran plus
 *     loin que `hover:`, sinon appuyer ne se distingue pas de survoler. L'enfoncement
 *     géométrique commun à tous les contrôles vient de `ui-pressable` (cf. index.css) : il
 *     ne dépend pas de la variante et n'est donc écrit qu'une fois, dans la base.
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

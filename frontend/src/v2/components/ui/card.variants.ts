// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { cva, type VariantProps } from 'class-variance-authority';

/**
 * Les variantes de la carte, isolées du composant pour être vérifiables sans rendu.
 *
 * L'échelle ne vient pas de shadcn — son `p-6` n'apparaît nulle part ici — mais du relevé
 * des surfaces réellement dessinées dans l'application : un panneau de réglages ou de
 * statistiques est `rounded-lg … p-4` (le motif de loin le plus fréquent), une ligne de
 * liste `rounded-md … px-3 py-2`. `variant` fixe la forme, `padding` la densité, et les
 * deux se combinent : un panneau et une ligne ne dosent pas leur marge de la même façon
 * (uniforme pour l'un, horizontale pour l'autre), d'où les combinaisons ci-dessous
 * plutôt qu'une seule échelle qui conviendrait mal aux deux.
 */
export const cardVariants = cva('border border-border bg-card text-card-foreground', {
  variants: {
    /** Panneau posé sur la page, ou ligne/bloc compact à l'intérieur d'une liste. */
    variant: { panel: 'rounded-lg', row: 'rounded-md' },
    /** `none` laisse l'espacement aux sous-composants (`CardHeader`, `CardContent`). */
    padding: { none: '', sm: '', md: '', lg: '' },
    /** Carte cliquable : la bordure répond au survol. */
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

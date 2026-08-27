// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { forwardRef, type ComponentPropsWithoutRef, type ComponentRef } from 'react';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Check } from 'lucide-react';
import { cn } from '../../lib/utils';

/**
 * Case à cocher accessible (Radix). Sert la multi-sélection des listes (13.A) : visible
 * au survol via `group-hover` ou en permanence quand cochée. La logique Shift/Ctrl est
 * portée par le gestionnaire d'`onClick` de l'appelant (les modificateurs de l'événement).
 */
const Checkbox = forwardRef<
  ComponentRef<typeof CheckboxPrimitive.Root>,
  ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      'flex h-4 w-4 shrink-0 items-center justify-center rounded border border-input bg-background/80 text-primary-foreground shadow-sm outline-none transition-colors',
      'focus-visible:ring-2 focus-visible:ring-ring',
      'data-[state=checked]:border-primary data-[state=checked]:bg-primary',
      /* Zone de saisie de 24 px (WCAG 2.5.8) autour d'une case qui garde son dessin de
         16 px : un pseudo-élément plutôt qu'une marge négative, pour ne pas déplacer la
         case dans les grilles serrées où elle est posée. */
      'relative before:absolute before:left-1/2 before:top-1/2 before:h-6 before:w-6 before:-translate-x-1/2 before:-translate-y-1/2 before:content-[""]',
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator>
      <Check size={12} strokeWidth={3} />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = 'Checkbox';

export { Checkbox };

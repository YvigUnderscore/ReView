// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { forwardRef, type ButtonHTMLAttributes } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Tooltip } from './tooltip';

/**
 * Bouton à icône seule des barres denses du chrome de review (options, transport, en-tête).
 * Promu depuis `HudIconButton` avec la refonte du chrome. `label` est obligatoire : il sert
 * d'`aria-label` et d'infobulle, et doit inclure le raccourci quand il y en a un.
 *
 * `bordered` pose la bordure des actions posées sur une surface claire ; `active` marque un
 * état enclenché (`aria-pressed`).
 *
 * ## `title` natif → primitive `Tooltip`
 *
 * Le libellé est ici la **seule** chose qui dit ce que fait le bouton : le laisser à
 * l'infobulle native, c'est le facturer ~1,5 s d'attente, sans thème, et le rendre
 * introuvable au clavier. `Tooltip` l'affiche en 250 ms et s'ouvre aussi au focus.
 *
 * L'`aria-label` **reste** : Radix décrit le déclencheur (`aria-describedby`), il ne le
 * nomme pas. C'est aussi la seule information qui survive au tactile — où ni l'infobulle
 * native ni celle-ci ne s'ouvrent. Le `title` natif, lui, disparaît : le garder afficherait
 * deux infobulles superposées.
 */
export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  icon: LucideIcon;
  label: string;
  bordered?: boolean;
  active?: boolean;
  size?: number;
}

const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ icon: Icon, label, bordered, active, size = 14, className, ...props }, ref) => (
    <Tooltip label={label}>
      <button
        ref={ref}
        type="button"
        aria-label={label}
        aria-pressed={active}
        className={cn(
          'ui-pressable flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          'disabled:pointer-events-none disabled:opacity-40',
          // `bordered` sert à poser le bouton sur une surface claire : c'est une limite de
          // contrôle, pas un séparateur — d'où `--border-strong` (3:1) et non `--border`.
          bordered && 'border border-border-strong',
          active
            ? 'bg-primary/15 text-primary hover:bg-primary/25 active:bg-primary/30'
            : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground active:bg-secondary',
          className,
        )}
        {...props}
      >
        <Icon size={size} />
      </button>
    </Tooltip>
  ),
);
IconButton.displayName = 'IconButton';

export { IconButton };

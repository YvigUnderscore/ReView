import { forwardRef, type ButtonHTMLAttributes } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';

/**
 * Bouton à icône seule des barres denses du chrome de review (options, transport, en-tête).
 * Promu depuis `HudIconButton` avec la refonte du chrome. `label` est obligatoire : il sert
 * d'`aria-label` et d'infobulle, et doit inclure le raccourci quand il y en a un.
 *
 * `bordered` pose la bordure des actions posées sur une surface claire ; `active` marque un
 * état enclenché (`aria-pressed`).
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
    <button
      ref={ref}
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        'flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        'disabled:pointer-events-none disabled:opacity-40',
        bordered && 'border border-border',
        active
          ? 'bg-primary/15 text-primary hover:bg-primary/25'
          : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
        className,
      )}
      {...props}
    >
      <Icon size={size} />
    </button>
  ),
);
IconButton.displayName = 'IconButton';

export { IconButton };

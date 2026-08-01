import type { LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';

/**
 * Choix exclusif de 2 à 5 options, sur une piste unique — mode de rendu, espace du gizmo,
 * canaux, mode de comparaison. Préféré à une rangée de boutons parce que l'exclusivité se
 * voit d'un coup d'œil. `size="lg"` sert la bascule de mode de l'en-tête ; `iconOnly`
 * réduit à des carrés de 28 px pour les barres denses.
 */
export interface SegmentedItem<T extends string> {
  value: T;
  label: string;
  icon?: LucideIcon;
  /** Infobulle — remplace le libellé quand `iconOnly`. */
  hint?: string;
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string> {
  items: SegmentedItem<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: 'sm' | 'lg';
  iconOnly?: boolean;
  /** Décrit le groupe pour les lecteurs d'écran. */
  label: string;
  className?: string;
}

export function SegmentedControl<T extends string>({
  items,
  value,
  onChange,
  size = 'sm',
  iconOnly,
  label,
  className,
}: SegmentedControlProps<T>) {
  const iconSize = size === 'lg' ? 15 : 13;
  return (
    <div
      role="group"
      aria-label={label}
      className={cn('inline-flex items-center gap-0.5 rounded-md bg-secondary/50 p-0.5', className)}
    >
      {items.map((item) => {
        const Icon = item.icon;
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            aria-pressed={active}
            title={item.hint ?? item.label}
            aria-label={iconOnly ? item.label : undefined}
            disabled={item.disabled}
            onClick={() => onChange(item.value)}
            className={cn(
              'flex items-center justify-center gap-1.5 whitespace-nowrap rounded border-0 bg-transparent font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              'disabled:cursor-not-allowed disabled:opacity-40',
              size === 'lg' ? 'min-h-8 px-3 text-sm' : 'min-h-7 px-2 text-xs',
              iconOnly && (size === 'lg' ? 'w-8 px-0' : 'w-7 px-0'),
              active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {Icon && <Icon size={iconSize} />}
            {!iconOnly && item.label}
          </button>
        );
      })}
    </div>
  );
}

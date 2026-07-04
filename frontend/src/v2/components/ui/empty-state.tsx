import type { ComponentType, ReactNode } from 'react';
import { cn } from '../../lib/utils';
import { Button } from './button';

/**
 * État vide accueillant : icône, message, action de création éventuelle.
 * `compact` pour les sous-sections (listes imbriquées), pleine hauteur sinon.
 */
export default function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  onAction,
  compact = false,
  className,
}: {
  icon?: ComponentType<{ size?: number | string; className?: string }>;
  title: string;
  description?: ReactNode;
  action?: string;
  onAction?: () => void;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-lg border border-dashed border-border text-center',
        compact ? 'gap-1.5 px-4 py-6' : 'gap-2 px-6 py-14',
        className,
      )}
    >
      {Icon && (
        <div
          className={cn(
            'flex items-center justify-center rounded-full bg-secondary text-muted-foreground',
            compact ? 'h-9 w-9' : 'h-12 w-12',
          )}
        >
          <Icon size={compact ? 18 : 24} />
        </div>
      )}
      <p className={cn('font-medium', compact ? 'text-sm' : 'text-base')}>{title}</p>
      {description && (
        <p className={cn('max-w-sm text-muted-foreground', compact ? 'text-xs' : 'text-sm')}>{description}</p>
      )}
      {action && onAction && (
        <Button size="sm" variant="outline" className="mt-2" onClick={onAction}>
          {action}
        </Button>
      )}
    </div>
  );
}

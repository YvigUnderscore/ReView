import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

/** Bloc de chargement pulsant. Composer plusieurs Skeleton pour mimer la mise en page cible. */
function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} {...props} />;
}

/** Grille de cartes en chargement (listes d'entités : projets, shots, assets…). */
function SkeletonCards({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="overflow-hidden rounded-lg border border-border">
          <Skeleton className="aspect-video w-full rounded-none" />
          <div className="space-y-2 p-3">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Lignes de liste en chargement (tableaux compacts, sous-sections). */
function SkeletonRows({ count = 3, className }: { count?: number; className?: string }) {
  return (
    <div className={cn('space-y-1.5', className)}>
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
    </div>
  );
}

export { Skeleton, SkeletonCards, SkeletonRows };

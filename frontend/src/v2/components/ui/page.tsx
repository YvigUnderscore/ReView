// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

/**
 * Largeur de page (A1). Le conteneur porte la gouttière : `Shell` n'en met plus,
 * sinon la variante `flush` ne pourrait pas occuper tout l'espace.
 *
 * - `default` : centré et borné — toutes les pages de données (listes, tableaux, réglages).
 *   Au-delà de ~1600 px l'œil doit traverser l'écran d'un bord à l'autre pour lire une ligne.
 * - `fluid`   : pleine largeur, même gouttière — kanban, board (la largeur y est utile).
 * - `flush`   : pleine largeur sans gouttière ni bornage — review, montage (plein espace assumé).
 */
export type PageWidth = 'default' | 'fluid' | 'flush';

const WIDTH_CLASS: Record<PageWidth, string> = {
  default: 'mx-auto w-full max-w-[1600px] p-6',
  fluid: 'w-full p-6',
  flush: 'flex h-full min-h-0 w-full flex-col',
};

export function PageContainer({
  width = 'default',
  className,
  children,
}: {
  width?: PageWidth;
  className?: string;
  children: ReactNode;
}) {
  return <div className={cn(WIDTH_CLASS[width], className)}>{children}</div>;
}

/**
 * En-tête de page : titre à gauche, actions à droite, passage à la ligne systématique.
 * Sans `flex-wrap`, une fenêtre étroite comprime le titre au lieu d'empiler les deux blocs.
 */
export function PageHeader({
  title,
  subtitle,
  actions,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-5 flex flex-wrap items-start justify-between gap-3', className)}>
      <div className="min-w-0">
        {typeof title === 'string' ? (
          <h1 className="truncate text-xl font-semibold text-foreground">{title}</h1>
        ) : (
          title
        )}
        {subtitle != null && <div className="mt-0.5 text-sm text-muted-foreground">{subtitle}</div>}
      </div>
      {actions != null && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

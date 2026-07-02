import type { HTMLAttributes, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { cn } from '../../lib/utils';

/** Fil d'Ariane : conteneur + éléments. Le dernier segment (page courante) utilise BreadcrumbPage. */
function Breadcrumb({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <nav aria-label="Fil d'Ariane" className={cn('min-w-0', className)} {...props} />;
}

function BreadcrumbList({ className, ...props }: HTMLAttributes<HTMLOListElement>) {
  return <ol className={cn('flex min-w-0 items-center gap-1 text-sm text-muted-foreground', className)} {...props} />;
}

function BreadcrumbItem({ className, ...props }: HTMLAttributes<HTMLLIElement>) {
  return <li className={cn('flex min-w-0 items-center gap-1', className)} {...props} />;
}

function BreadcrumbLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="max-w-48 truncate rounded px-1 py-0.5 transition-colors hover:bg-secondary/60 hover:text-foreground">
      {children}
    </Link>
  );
}

/** Segment courant (non cliquable). */
function BreadcrumbPage({ children }: { children: ReactNode }) {
  return <span aria-current="page" className="max-w-56 truncate px-1 py-0.5 font-medium text-foreground">{children}</span>;
}

function BreadcrumbSeparator() {
  return <ChevronRight size={14} className="shrink-0 text-muted-foreground/60" aria-hidden />;
}

export { Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbLink, BreadcrumbPage, BreadcrumbSeparator };

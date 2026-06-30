import { Link } from 'react-router-dom';
import { Image as ImageIcon, Pencil, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import type { ViewMode } from '../stores/useViewPref';

export interface EntityItemAction {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}

export interface EntityCardProps {
  to?: string;
  onClick?: () => void;
  active?: boolean;
  title: string;
  subtitle?: string;
  badge?: ReactNode;
  thumbnailUrl?: string | null;
  view: ViewMode;
  /** Boutons d'action (édition/suppression…) visibles au survol. */
  actions?: EntityItemAction[];
}

function Actions({ actions }: { actions?: EntityItemAction[] }) {
  if (!actions?.length) return null;
  return (
    <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
      {actions.map((a) => (
        <button
          key={a.label}
          title={a.label}
          aria-label={a.label}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); a.onClick(); }}
          className={`flex h-7 w-7 items-center justify-center rounded-md hover:bg-secondary ${
            a.danger ? 'text-destructive' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {a.icon}
        </button>
      ))}
    </div>
  );
}

/** Carte ou ligne compacte selon `view`. Cliquable via `to` (lien) ou `onClick`. */
export default function EntityCard({ to, onClick, active, title, subtitle, badge, thumbnailUrl, view, actions }: EntityCardProps) {
  const activeRing = active ? 'border-primary ring-1 ring-primary' : 'border-border';
  const clickable = onClick ? 'cursor-pointer text-left w-full' : '';

  const wrap = (inner: ReactNode) => {
    if (to) return <Link to={to}>{inner}</Link>;
    if (onClick) return <button type="button" onClick={onClick} className="block w-full text-left">{inner}</button>;
    return inner;
  };

  if (view === 'compact') {
    return wrap(
      <div className={`group flex items-center gap-3 rounded-md border ${activeRing} bg-card px-3 py-2 transition-colors hover:border-primary ${clickable}`}>
        <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded bg-secondary/60">
          {thumbnailUrl ? (
            <img src={thumbnailUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <ImageIcon size={14} className="text-muted-foreground" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{title}</div>
          {subtitle && <div className="truncate text-xs text-muted-foreground">{subtitle}</div>}
        </div>
        {badge}
        <Actions actions={actions} />
      </div>,
    );
  }

  // Vue cartes
  return wrap(
    <div className={`group overflow-hidden rounded-lg border ${activeRing} bg-card transition-colors hover:border-primary`}>
      <div className="relative flex aspect-video items-center justify-center bg-secondary/40">
        {thumbnailUrl ? (
          <img src={thumbnailUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <ImageIcon size={28} className="text-muted-foreground/50" />
        )}
        <div className="absolute right-1.5 top-1.5">
          <Actions actions={actions} />
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 p-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{title}</div>
          {subtitle && <div className="truncate text-xs text-muted-foreground">{subtitle}</div>}
        </div>
        {badge}
      </div>
    </div>,
  );
}

/** Conteneur adaptatif : grille en mode cartes, pile en mode compact. */
export function EntityContainer({ view, children }: { view: ViewMode; children: ReactNode }) {
  return view === 'cards' ? (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{children}</div>
  ) : (
    <div className="space-y-1.5">{children}</div>
  );
}

/** Icônes d'action prêtes à l'emploi. */
export const EditIcon = <Pencil size={14} />;
export const DeleteIcon = <Trash2 size={14} />;

import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * HUD du viewer splat (10.G-V1) : groupes flottants superposés au canvas (toolbars d'édition,
 * stats, réglages), façon logiciel 3D. Le conteneur laisse passer le pointeur (orbite,
 * sélection, vol sous le HUD) ; chaque groupe (`HudGroup`) le capte.
 */
export function HudGroup({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`pointer-events-auto flex max-w-full flex-wrap items-center gap-2 rounded-md border border-border bg-card/85 px-2 py-1.5 text-xs shadow-sm backdrop-blur ${className}`}
    >
      {children}
    </div>
  );
}

/** Bouton icône du HUD (toggle stats/réglages…) — défini au niveau module, pas dans le render. */
export function HudIconButton({
  icon: Icon,
  hint,
  active,
  onClick,
}: {
  icon: LucideIcon;
  hint: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={hint}
      aria-pressed={active}
      className={`flex items-center justify-center rounded p-1.5 transition-colors ${
        active
          ? 'bg-primary text-primary-foreground'
          : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
      }`}
    >
      <Icon size={14} />
    </button>
  );
}

export default function ViewerHud({
  topLeft,
  topRight,
  bottomLeft,
}: {
  topLeft?: ReactNode;
  topRight?: ReactNode;
  bottomLeft?: ReactNode;
}) {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex flex-col justify-between p-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 flex-col items-start gap-1.5">{topLeft}</div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">{topRight}</div>
      </div>
      {bottomLeft && <div className="flex flex-col items-start gap-1.5">{bottomLeft}</div>}
    </div>
  );
}

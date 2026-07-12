import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * HUD unifié des viewers de review (14.A — généralisé depuis le splat 10.G-V1). Groupes
 * flottants superposés au canvas façon logiciel 3D. Le conteneur laisse passer le pointeur
 * (orbite/scrub/sélection sous le HUD) ; chaque groupe (`HudGroup`) le capte.
 *
 * Zones : haut-gauche = outils (annotation), haut-droit = infos/réglages/stats,
 * bas-centre = transport du média (lecteur vidéo, zoom image), bas-gauche = extra
 * (filmstrip, trim…).
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
  disabled,
}: {
  icon: LucideIcon;
  hint: string;
  active?: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={hint}
      aria-pressed={active}
      disabled={disabled}
      className={`flex items-center justify-center rounded p-1.5 transition-colors disabled:opacity-40 ${
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
  bottomCenter,
}: {
  topLeft?: ReactNode;
  topRight?: ReactNode;
  bottomLeft?: ReactNode;
  bottomCenter?: ReactNode;
}) {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex flex-col justify-between p-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 flex-col items-start gap-1.5">{topLeft}</div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">{topRight}</div>
      </div>
      {(bottomLeft || bottomCenter) && (
        <div className="flex items-end justify-between gap-2">
          <div className="flex flex-col items-start gap-1.5">{bottomLeft}</div>
          <div className="flex flex-1 flex-col items-center gap-1.5">{bottomCenter}</div>
          {/* colonne fantôme pour centrer le transport malgré une zone bas-gauche étroite */}
          <div className="w-0 shrink-0" />
        </div>
      )}
    </div>
  );
}

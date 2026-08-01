import { ChevronsLeft, ChevronsRight, type LucideIcon } from 'lucide-react';
import type { ReviewTool, ToolId, ViewAction } from './tools';

/**
 * Rail d'outils — colonne de gauche. Il ne contient que les outils de pointage exclusifs du
 * mode actif (un seul armé à la fois) puis, après un séparateur, les deux actions de vue.
 * Remplace les piles de groupes flottants de l'ancien `ViewerHud` : plus rien ne recouvre
 * l'image qu'on demande de juger.
 */
export function RailButton({
  icon: Icon,
  label,
  text,
  shortcut,
  hint,
  active,
  labels,
  onClick,
  className,
}: {
  icon: LucideIcon;
  /** Nom accessible et infobulle — la phrase complète. */
  label: string;
  /** Texte affiché rail déplié, quand il doit être plus court que `label`. */
  text?: string;
  shortcut?: string;
  hint?: string;
  active?: boolean;
  /** Rail déplié : le libellé et le raccourci s'affichent à côté de l'icône. */
  labels?: boolean;
  onClick: () => void;
  className?: string;
}) {
  const title = [label + (shortcut ? ` (${shortcut})` : ''), hint].filter(Boolean).join(' — ');
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={label}
      title={title}
      onClick={onClick}
      className={`rv-railbtn${active ? ' rv-railbtn--active' : ''}${className ? ` ${className}` : ''}`}
    >
      <Icon size={17} />
      {labels && (
        <>
          <span className="truncate">{text ?? label}</span>
          {shortcut && <span className="rv-railbtn__key">{shortcut}</span>}
        </>
      )}
    </button>
  );
}

export default function ToolRail({
  tools,
  actions,
  tool,
  onTool,
  onAction,
  labels,
  onLabels,
}: {
  tools: ReviewTool[];
  actions: ViewAction[];
  tool: ToolId;
  onTool: (tool: ToolId) => void;
  onAction: (action: ViewAction['id']) => void;
  labels: boolean;
  onLabels: () => void;
}) {
  return (
    <div className={`rv-rail${labels ? ' rv-rail--labels' : ''}`}>
      {labels && <span className="rv-rail__title">Outils</span>}
      {tools.map((t) => (
        <RailButton
          key={t.id}
          icon={t.icon}
          label={t.label}
          shortcut={t.key}
          hint={t.hint}
          active={tool === t.id}
          labels={labels}
          onClick={() => onTool(t.id)}
        />
      ))}
      {actions.length > 0 && <div className="rv-rail__sep" />}
      {actions.map((a) => (
        <RailButton
          key={a.id}
          icon={a.icon}
          label={a.label}
          shortcut={a.key}
          labels={labels}
          onClick={() => onAction(a.id)}
        />
      ))}
      <RailButton
        icon={labels ? ChevronsLeft : ChevronsRight}
        label={labels ? 'Masquer les libellés des outils' : 'Afficher les libellés des outils'}
        text="Réduire"
        labels={labels}
        onClick={onLabels}
        className="mt-auto"
      />
    </div>
  );
}

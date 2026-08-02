// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { ChevronsLeft, ChevronsRight, type LucideIcon } from 'lucide-react';
import type { ReviewTool, ToolId, ViewAction } from './tools';
import { useT } from '../../../i18n';

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
  const t = useT();
  return (
    <div className={`rv-rail${labels ? ' rv-rail--labels' : ''}`}>
      {labels && <span className="rv-rail__title">{t('rail.tools')}</span>}
      {tools.map((item) => (
        <RailButton
          key={item.id}
          icon={item.icon}
          label={t(item.labelKey)}
          shortcut={item.key}
          hint={t(item.hintKey)}
          active={tool === item.id}
          labels={labels}
          onClick={() => onTool(item.id)}
        />
      ))}
      {actions.length > 0 && <div className="rv-rail__sep" />}
      {actions.map((a) => (
        <RailButton
          key={a.id}
          icon={a.icon}
          label={t(a.labelKey)}
          shortcut={a.key}
          labels={labels}
          onClick={() => onAction(a.id)}
        />
      ))}
      <RailButton
        icon={labels ? ChevronsLeft : ChevronsRight}
        label={labels ? t('rail.hideLabels') : t('rail.showLabels')}
        text="Réduire"
        labels={labels}
        onClick={onLabels}
        className="mt-auto"
      />
    </div>
  );
}

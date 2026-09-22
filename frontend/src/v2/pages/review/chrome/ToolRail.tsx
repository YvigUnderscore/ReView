// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { ChevronsLeft, ChevronsRight, type LucideIcon } from 'lucide-react';
import type { ModeId } from './modes';
import type { RailSection, ToolId, ViewAction } from './tools';
import { useT } from '../../../i18n';

/**
 * Rail d'outils — colonne de gauche. Il ne contient que les outils de pointage exclusifs du
 * mode actif (un seul armé à la fois) puis, après un séparateur, les deux actions de vue.
 * Remplace les piles de groupes flottants de l'ancien `ViewerHud` : plus rien ne recouvre
 * l'image qu'on demande de juger.
 *
 * Le rail porte **un ou plusieurs groupes** (`RailSection`) : le premier est celui du mode
 * courant, les suivants ceux des modes qui ne figurent pas dans la bascule d'en-tête — c'est
 * ainsi que l'édition du nuage revient au rail sans rendre son segment (Phase 50, lot 13).
 * Cliquer un outil arme le couple mode + outil de son groupe, exactement comme sa lettre.
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
  sections,
  actions,
  mode,
  tool,
  onTool,
  onAction,
  labels,
  onLabels,
}: {
  /** Groupes du rail, dans l'ordre : le mode courant d'abord. */
  sections: RailSection[];
  actions: ViewAction[];
  /** Mode courant — un outil n'est actif que dans le groupe qui l'arme. */
  mode: ModeId;
  tool: ToolId;
  onTool: (tool: ToolId, mode: ModeId) => void;
  onAction: (action: ViewAction['id']) => void;
  labels: boolean;
  onLabels: () => void;
}) {
  const t = useT();
  return (
    <div className={`rv-rail${labels ? ' rv-rail--labels' : ''}`}>
      {sections.map((section, index) => (
        <div key={section.mode} className="contents">
          {/* Séparateur entre groupes : rail replié, c'est le seul indice qu'on change de
              famille d'outils — le titre, lui, n'existe que déplié. */}
          {index > 0 && <div className="rv-rail__sep" />}
          {labels && <span className="rv-rail__title">{t(section.titleKey)}</span>}
          {section.tools.map((item) => (
            <RailButton
              key={item.id}
              icon={item.icon}
              label={t(item.labelKey)}
              shortcut={item.key}
              hint={t(item.hintKey)}
              active={mode === section.mode && tool === item.id}
              labels={labels}
              onClick={() => onTool(item.id, section.mode)}
            />
          ))}
        </div>
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
        text={t('common.collapse')}
        labels={labels}
        onClick={onLabels}
        className="mt-auto"
      />
    </div>
  );
}

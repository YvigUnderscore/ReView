// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { ChevronsLeft, ChevronsRight, type LucideIcon } from 'lucide-react';
import type { ModeId } from './modes';
import type { RailSection, ToolId, ViewAction } from './tools';
import { useT } from '@/v2/i18n';

/**
 * Tool rail — left column. It only holds the pointing tools exclusive to the active mode (one armed
 * at a time), then, after a separator, the two view actions. Replaces the stacks of floating groups
 * of the old `ViewerHud`: nothing covers the image being judged any more.
 *
 * The rail carries **one or more groups** (`RailSection`): the first is the current mode's, the
 * following ones those of the modes absent from the header toggle — this is how cloud editing
 * returns to the rail without rendering its segment (Phase 50, batch 13). Clicking a tool arms the
 * mode + tool pair of its group, exactly like its key letter.
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
  /** Accessible name and tooltip — the full sentence. */
  label: string;
  /** Text shown with the rail expanded, when it must be shorter than `label`. */
  text?: string;
  shortcut?: string;
  hint?: string;
  active?: boolean;
  /** Rail expanded: the label and shortcut are shown next to the icon. */
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
  /** Rail groups, in order: the current mode first. */
  sections: RailSection[];
  actions: ViewAction[];
  /** Current mode — a tool is only active in the group that arms it. */
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
          {/* Separator between groups: with the rail folded, it is the only hint that the tool
              family changes — the title only exists when expanded. */}
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

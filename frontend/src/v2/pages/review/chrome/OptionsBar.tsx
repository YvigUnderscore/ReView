// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReactNode } from 'react';
import { Check, Redo2, Undo2 } from 'lucide-react';
import { Button } from '@/v2/components/ui/button';
import { IconButton } from '@/v2/components/ui/icon-button';
import type { ReviewTool } from './tools';
import { useT } from '@/v2/i18n';

/**
 * Options bar — a line under the header that only shows the parameters of the **active** tool.
 * This is what keeps everything without stacking: switching tool changes the line, instead of
 * adding one more floating group above the media.
 *
 * The parameter area scrolls horizontally; the commit group stays pinned outside the scroll so
 * that the main action is always reachable.
 */
export default function OptionsBar({
  tool,
  commit,
  children,
}: {
  tool: ReviewTool;
  /** Commit group (`CommitGroup`) — only in the modes that write. */
  commit?: ReactNode;
  children?: ReactNode;
}) {
  const t = useT();
  const Icon = tool.icon;
  return (
    <div className="rv-optbar">
      <div className="rv-optbar__scroll">
        <span className="rv-optbar__name">
          <Icon size={14} />
          {t(tool.labelKey)}
          {tool.key && <span className="rv-kbd">{tool.key}</span>}
        </span>
        <span className="rv-rule" />
        {children}
      </div>
      {commit}
    </div>
  );
}

/**
 * Undo / redo / save. The "unsaved" state is read from a dot in the button, never from a status
 * text placed next to it: the bar is already dense.
 */
export function CommitGroup({
  dirty,
  label,
  hint,
  onSave,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  saving,
}: {
  dirty: boolean;
  label: string;
  /** What is not saved — shown as a tooltip when `dirty`. */
  hint: string;
  onSave: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  saving?: boolean;
}) {
  const t = useT();
  return (
    <div className="rv-optbar__commit">
      {onUndo && (
        <IconButton icon={Undo2} label={t('review.undoShortcut')} onClick={onUndo} disabled={!canUndo} />
      )}
      {onRedo && (
        <IconButton icon={Redo2} label={t('review.redoShortcut')} onClick={onRedo} disabled={!canRedo} />
      )}
      <Button
        size="sm"
        disabled={!dirty || saving}
        onClick={onSave}
        title={dirty ? hint : t('common.allSaved')}
      >
        {dirty ? <span className="rv-dot" /> : <Check size={13} />}
        {label}
      </Button>
    </div>
  );
}

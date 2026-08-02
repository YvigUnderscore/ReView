// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReactNode } from 'react';
import { Check, Redo2, Undo2 } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { IconButton } from '../../../components/ui/icon-button';
import type { ReviewTool } from './tools';
import { useT } from '../../../i18n';

/**
 * Barre d'options — une ligne sous l'en-tête, qui ne montre que les paramètres de l'outil
 * **actif**. C'est ce qui permet de tout garder sans rien empiler : changer d'outil change la
 * ligne, au lieu d'ajouter un groupe flottant de plus au-dessus du média.
 *
 * La zone des paramètres défile horizontalement ; le groupe de validation reste épinglé hors
 * du défilement pour que l'action principale soit toujours atteignable.
 */
export default function OptionsBar({
  tool,
  commit,
  children,
}: {
  tool: ReviewTool;
  /** Groupe de validation (`CommitGroup`) — seulement dans les modes qui écrivent. */
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
 * Annuler / rétablir / enregistrer. L'état « non enregistré » se lit à une pastille dans le
 * bouton, jamais à un texte d'état posé à côté : la barre est déjà dense.
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
  /** Ce qui n'est pas enregistré — affiché en infobulle quand `dirty`. */
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

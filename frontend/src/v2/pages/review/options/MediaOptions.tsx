// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReactNode } from 'react';
import { Eraser, LogIn, LogOut, Redo2, Undo2, X } from 'lucide-react';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { IconButton } from '../../../components/ui/icon-button';
import { NumberField } from '../../../components/ui/number-field';
import { SegmentedControl } from '../../../components/ui/segmented-control';
import { USER_COLORS } from '../../../lib/userColor';
import OptionsBar, { CommitGroup } from '../chrome/OptionsBar';
import type { ModeId } from '../chrome/modes';
import type { ReviewTool } from '../chrome/tools';
import type { CompareMode } from '../useCompareState';
import type { Annotations } from '../useAnnotations';
import { useT, type MessageKey } from '../../../i18n';

/** Traducteur passé aux tables de libellés, recalculées à chaque rendu. */
type Tr = (key: MessageKey) => string;

const DRAWING = new Set(['draw', 'rect', 'ellipse', 'arrow', 'polygon', 'text']);

/** Encres proposées d'emblée — cinq teintes distinctes de la palette utilisateur. */
const INK = [USER_COLORS[6], USER_COLORS[11], USER_COLORS[2], USER_COLORS[4], USER_COLORS[8]];

const compare_modes = (t: Tr) => [
  { value: 'wipe' as const, label: 'Wipe' },
  { value: 'diff' as const, label: t('review.compare.diff') },
  { value: 'side' as const, label: t('review.compare.sideBySide') },
];

/**
 * Barre d'options des viewers plats (vidéo, image) : les paramètres du seul outil armé.
 * Remplace la palette d'annotation qui vivait sous le champ de commentaire et la barre de
 * trim posée sous le lecteur — les outils sont passés au rail, il ne reste ici que l'encre,
 * l'épaisseur, l'opacité et les actions de l'outil.
 */
export default function MediaOptions({
  tool,
  mode,
  ann,
  compare,
  trim,
}: {
  tool: ReviewTool;
  mode: ModeId;
  ann: Annotations;
  /** Comparaison A/B — mode partagé avec la session live. */
  compare?: {
    mode: CompareMode;
    onMode: (mode: CompareMode) => void;
    hasB: boolean;
    /** Réglages A et B (`CompareAB`) — montés par le chrome, absents en vidéo. */
    ab?: ReactNode;
  };
  /** Découpe vidéo (gestionnaire, pré-publication). */
  trim?: {
    inFrame: number | null;
    outFrame: number | null;
    onIn: () => void;
    onOut: () => void;
    onClear: () => void;
    onApply: () => void;
    dirty: boolean;
    busy: boolean;
    label: string;
  };
}) {
  const t = useT();
  const id = tool.id;
  const drawing = DRAWING.has(id);

  const commit =
    mode === 'edit' && trim ? (
      <CommitGroup
        dirty={trim.dirty}
        saving={trim.busy}
        label={t('common.save')}
        hint={t('review.trim.unsaved')}
        onSave={trim.onApply}
      />
    ) : undefined;

  return (
    <OptionsBar tool={tool} commit={commit}>
      {/* L'aide de l'outil s'efface en comparaison : la ligne y porte les réglages A et B. */}
      {(id === 'nav' || id === 'zoom') && mode !== 'compare' && (
        <span className="rv-optbar__hint">{t(tool.hintKey)}</span>
      )}

      {/* Comparaison : les réglages restent affichés quel que soit l'outil armé — c'est le
          mode qui compare, pas l'outil, et le choix de B doit se voir. */}
      {mode === 'compare' && compare && (
        <>
          {compare.ab}
          {compare.hasB && (
            <>
              <span className="rv-rule" />
              <SegmentedControl
                label={t('review.compare.mode')}
                items={compare_modes(t)}
                value={compare.mode}
                onChange={compare.onMode}
              />
            </>
          )}
        </>
      )}

      {/* Annuler/Rétablir/Effacer suivent ce qu'il y a À DÉFAIRE, pas l'outil armé : ils
          disparaissaient dès qu'on désarmait le tracé, alors que les formes et les références
          collées, elles, restaient attachées au commentaire. Le clavier (Ctrl+Z / Ctrl+Y /
          Ctrl+Maj+Z) couvre le même besoin depuis la phase 50 ; ces boutons en sont la
          contrepartie visible. Les réglages d'encre, eux, restent propres au tracé. */}
      {(drawing ||
        id === 'shape-move' ||
        id === 'erase' ||
        ann.canUndo ||
        ann.canRedo ||
        ann.annot.length > 0) && (
        <>
          {drawing && (
            <>
              <span className="rv-row__label">{t('draw.ink')}</span>
              <span className="flex gap-1">
                {INK.map((c) => (
                  <button
                    key={c}
                    type="button"
                    title={t('draw.inkColor', { color: c })}
                    aria-label={t('draw.inkColor', { color: c })}
                    aria-pressed={ann.color.toLowerCase() === c.toLowerCase()}
                    onClick={() => ann.setColor(c)}
                    className={`h-5 w-5 rounded-full border-2 ${
                      ann.color.toLowerCase() === c.toLowerCase() ? 'border-foreground' : 'border-transparent'
                    }`}
                    style={{ backgroundColor: c }}
                  />
                ))}
                {/* Couleur libre : le sélecteur natif s'ouvre hors de la page, il ne recouvre
                    jamais le média — c'est tout l'intérêt par rapport à l'ancienne palette. */}
                <input
                  type="color"
                  value={ann.color}
                  onChange={(e) => ann.setColor(e.target.value)}
                  title={t('draw.otherInk')}
                  aria-label={t('draw.otherInk')}
                  className="h-5 w-5 cursor-pointer rounded-full border border-border bg-transparent p-0"
                />
              </span>
              <NumberField
                label={t('review.thickness')}
                value={ann.penWidth}
                onChange={ann.setPenWidth}
                min={1}
                max={24}
                step={1}
                unit="px"
              />
              <NumberField
                label={t('review.opacity')}
                value={Math.round(ann.alpha * 100)}
                onChange={(v) => ann.setAlpha(v / 100)}
                min={10}
                max={100}
                step={5}
                unit="%"
              />
            </>
          )}
          {(id === 'shape-move' || id === 'erase') && (
            <span className="rv-optbar__hint">{t('draw.pickShape')}</span>
          )}
          <span className="rv-rule" />
          <IconButton
            icon={Undo2}
            label={t('review.undoStroke')}
            bordered
            onClick={ann.undo}
            disabled={!ann.canUndo}
          />
          <IconButton
            icon={Redo2}
            label={t('common.redo')}
            bordered
            onClick={ann.redo}
            disabled={!ann.canRedo}
          />
          <IconButton
            icon={Eraser}
            label={t('draw.clearAll')}
            bordered
            onClick={ann.clear}
            disabled={ann.annot.length === 0}
          />
          <span className="rv-optbar__hint">
            {ann.annot.length > 0
              ? t('draw.shapesAttached', { count: ann.annot.length })
              : t('draw.goesWithComment')}
          </span>
        </>
      )}

      {(id === 'in' || id === 'out') && trim && (
        <>
          <span className="rv-optbar__hint">{trim.label}</span>
          <span className="rv-rule" />
          <Button size="sm" variant="outline" onClick={trim.onIn}>
            <LogIn size={13} />
            {t('review.markerHere')}
          </Button>
          <Button size="sm" variant="outline" onClick={trim.onOut}>
            <LogOut size={13} />
            {t('video.outHere')}
          </Button>
          <IconButton
            icon={X}
            label={t('review.clearTrim')}
            bordered
            onClick={trim.onClear}
            disabled={trim.inFrame == null && trim.outFrame == null}
          />
        </>
      )}

      {id === 'range' && (
        <>
          <span className="rv-optbar__hint">{t('video.loopHint')}</span>
          <span className="rv-rule" />
          <Badge variant="secondary">{t('review.rangeAttached')}</Badge>
        </>
      )}
    </OptionsBar>
  );
}

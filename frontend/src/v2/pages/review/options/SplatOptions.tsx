// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Circle, Cuboid, Eraser, Focus, MapPin, Plus, Trash2, Undo2, X } from 'lucide-react';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { IconButton } from '../../../components/ui/icon-button';
import { NumberField } from '../../../components/ui/number-field';
import OptionsBar, { CommitGroup } from '../chrome/OptionsBar';
import type { ReviewTool, ToolId } from '../chrome/tools';
import type { ModeId } from '../chrome/modes';
import type { SplatEditorState } from '../splat/editor/useSplatEditor';
import type { SplatPaintState } from '../splat/paint/useSplatPaint';
import TransformOptions from './TransformOptions';
import { useT } from '../../../i18n';

/** Couleurs de trait du painter 3D — données d'annotation, pas des tokens de thème. */
const INK = ['#ff4d4d', '#ffb020', '#3ddc68', '#38b6ff'];

/**
 * Barre d'options du viewer splat : les paramètres du seul outil armé. Remplace
 * `SplatEditorToolbar`, `VolumesBar`, `PaintBar` et `TransformFields`, qui s'empilaient tous
 * ensemble dans le coin haut-gauche par-dessus le nuage.
 *
 * Le groupe de validation n'apparaît que dans les modes qui écrivent — « Nettoyer » enregistre
 * les éditions, « Mise en scène » publie la présentation rejouée pour tous.
 */
export default function SplatOptions({
  tool,
  mode,
  editor,
  paint,
  presentation,
  onPlaceHotspot,
}: {
  tool: ReviewTool;
  mode: ModeId;
  editor: SplatEditorState;
  paint: SplatPaintState;
  /** Mise en scène : enregistrement de la présentation par le gestionnaire. */
  presentation?: { dirty: boolean; busy: boolean; onSave: () => void };
  onPlaceHotspot: () => void;
}) {
  const t = useT();
  const id: ToolId = tool.id;
  const selecting = id === 'sel-rect' || id === 'sel-lasso' || id === 'sel-brush';
  const transforming = id === 'translate' || id === 'rotate' || id === 'scale';
  const selectedCount = editor.selection.selected.size;

  const commit =
    mode === 'clean' ? (
      <CommitGroup
        dirty={editor.dirty}
        saving={editor.busy}
        label={t('common.save')}
        hint={t('review.splat.unsavedEdits')}
        onSave={() => void editor.save()}
        onUndo={editor.history.undo}
        onRedo={editor.history.redo}
        canUndo={editor.history.canUndo}
        canRedo={editor.history.canRedo}
      />
    ) : mode === 'stage' && presentation ? (
      <CommitGroup
        dirty={presentation.dirty}
        saving={presentation.busy}
        label="Publier"
        hint={t('review.staging.unsaved')}
        onSave={presentation.onSave}
      />
    ) : undefined;

  return (
    <OptionsBar tool={tool} commit={commit}>
      {id === 'nav' && <span className="rv-optbar__hint">{tool.hint}</span>}

      {id === 'focus' && (
        <span className="rv-optbar__hint">
          Cliquer un point du splat pour y poser la mise au point. L’ouverture se règle dans le dock Caméra.
        </span>
      )}

      {id === 'pin' && (
        <>
          <span className="rv-optbar__hint">{t('review.markerHint')}</span>
          <span className="rv-rule" />
          <Button size="sm" variant="outline" onClick={onPlaceHotspot}>
            <MapPin size={13} />
            {t('review.markerPlace')}
          </Button>
        </>
      )}

      {id === 'paint' && (
        <>
          <span className="rv-row__label">Encre</span>
          <span className="flex gap-1">
            {INK.map((c) => (
              <button
                key={c}
                type="button"
                title={`Encre ${c}`}
                aria-label={`Encre ${c}`}
                aria-pressed={paint.color === c}
                onClick={() => paint.setColor(c)}
                className={`h-5 w-5 rounded-full border-2 ${
                  paint.color === c ? 'border-foreground' : 'border-transparent'
                }`}
                style={{ backgroundColor: c }}
              />
            ))}
          </span>
          <NumberField
            label={t('review.thickness')}
            value={paint.width}
            onChange={paint.setWidth}
            min={1}
            max={5}
            step={1}
            unit="px"
          />
          <span className="rv-rule" />
          <IconButton
            icon={Undo2}
            label={t('review.undoStroke')}
            bordered
            onClick={paint.undoStroke}
            disabled={paint.pendingCount === 0}
          />
          <IconButton
            icon={Eraser}
            label={t('review.splat.clearStrokes')}
            bordered
            onClick={paint.clearPending}
            disabled={paint.pendingCount === 0}
          />
          <span className="rv-optbar__hint">
            {paint.pendingCount > 0
              ? `${paint.pendingCount} trait${paint.pendingCount > 1 ? 's' : ''} partiront avec le commentaire.`
              : 'Les traits partent avec le commentaire.'}
          </span>
        </>
      )}

      {(id === 'cam-move' || id === 'cam-aim') && (
        <span className="rv-optbar__hint">
          La caméra-objet est visible dans la scène ; sa trajectoire suit les clés du transport.
        </span>
      )}

      {selecting && (
        <>
          {id === 'sel-brush' && (
            <NumberField
              label="Rayon"
              value={editor.brushRadius}
              onChange={editor.setBrushRadius}
              min={8}
              max={150}
              step={1}
              unit="px"
            />
          )}
          <span className="rv-optbar__hint">Maj ajoute · Alt retire</span>
          <span className="rv-rule" />
          <Badge variant={selectedCount ? 'default' : 'muted'}>
            {selectedCount.toLocaleString('fr-FR')} sélectionnés
          </Badge>
          <IconButton
            icon={X}
            label={t('review.splat.deselectAll')}
            bordered
            onClick={editor.selection.clear}
            disabled={!selectedCount}
          />
          <Button size="sm" variant="outline" disabled={!selectedCount} onClick={editor.deleteSelection}>
            <Trash2 size={13} />
            {t('common.delete')}
          </Button>
          {editor.deletedCount > 0 && (
            <span className="rv-optbar__hint">
              {editor.deletedCount.toLocaleString('fr-FR')} masqués · non destructif
            </span>
          )}
        </>
      )}

      {id === 'volume' && (
        <>
          <Button size="sm" variant="outline" onClick={() => void editor.volumes.add('box')}>
            <Plus size={13} />
            <Cuboid size={13} />
            {t('review.box')}
          </Button>
          <Button size="sm" variant="outline" onClick={() => void editor.volumes.add('sphere')}>
            <Plus size={13} />
            <Circle size={13} />
            {t('review.sphere')}
          </Button>
          <span className="rv-rule" />
          {editor.volumes.volumes.length === 0 && (
            <span className="rv-optbar__hint">{t('review.splat.noVolume')}</span>
          )}
          {editor.volumes.volumes.map((v, i) => {
            const active = editor.volumes.activeId === v.id;
            const ShapeIcon = v.shape === 'box' ? Cuboid : Circle;
            return (
              <span
                key={v.id}
                className={`flex items-center gap-1.5 rounded-md bg-secondary/40 px-2 py-1 ${
                  active ? 'ring-1 ring-primary' : ''
                }`}
              >
                <button
                  type="button"
                  onClick={() => editor.volumes.select(v.id)}
                  title={active ? 'Détacher le gizmo du volume' : 'Attacher le gizmo à ce volume'}
                  className={`flex items-center gap-1.5 font-medium ${
                    active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <ShapeIcon size={13} /> {v.shape === 'box' ? t('review.box') : t('review.sphere')} {i + 1}
                </button>
                <button
                  type="button"
                  onClick={() => editor.volumes.toggleMode(v.id)}
                  title={
                    v.mode === 'delete'
                      ? 'Creuse (supprime l’intérieur) — basculer vers isoler'
                      : 'Isole (garde l’intérieur) — basculer vers creuser'
                  }
                  className={`flex items-center gap-1 rounded px-1 py-0.5 hover:bg-secondary ${
                    v.mode === 'delete' ? 'text-destructive' : 'text-primary'
                  }`}
                >
                  {v.mode === 'delete' ? <Eraser size={12} /> : <Focus size={12} />}
                  {v.mode === 'delete' ? 'Creuser' : 'Isoler'}
                </button>
                <IconButton
                  icon={X}
                  label={t('review.splat.removeVolume')}
                  size={12}
                  className="h-5 w-5"
                  onClick={() => editor.volumes.remove(v.id)}
                />
              </span>
            );
          })}
        </>
      )}

      {transforming && (
        <TransformOptions
          tool={id}
          target={editor.fields.label}
          shape={editor.fields.shape}
          value={editor.fields.value}
          onCommit={editor.fields.commit}
          gizmo={editor.gizmo}
        />
      )}
    </OptionsBar>
  );
}

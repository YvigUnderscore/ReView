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

const DRAWING = new Set(['draw', 'rect', 'ellipse', 'arrow', 'polygon', 'text']);

/** Encres proposées d'emblée — cinq teintes distinctes de la palette utilisateur. */
const INK = [USER_COLORS[6], USER_COLORS[11], USER_COLORS[2], USER_COLORS[4], USER_COLORS[8]];

const COMPARE_MODES = [
  { value: 'wipe' as const, label: 'Wipe' },
  { value: 'diff' as const, label: 'Différence' },
  { value: 'side' as const, label: 'Côte à côte' },
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
  /** Comparaison A/B — mode partagé avec le dock et la session live. */
  compare?: {
    mode: CompareMode;
    onMode: (mode: CompareMode) => void;
    hasB: boolean;
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
  const id = tool.id;
  const drawing = DRAWING.has(id);

  const commit =
    mode === 'edit' && trim ? (
      <CommitGroup
        dirty={trim.dirty}
        saving={trim.busy}
        label="Enregistrer"
        hint="Découpe non enregistrée"
        onSave={trim.onApply}
      />
    ) : undefined;

  return (
    <OptionsBar tool={tool} commit={commit}>
      {(id === 'nav' || id === 'zoom') && <span className="rv-optbar__hint">{tool.hint}</span>}

      {(drawing || id === 'shape-move' || id === 'erase') && (
        <>
          {drawing && (
            <>
              <span className="rv-row__label">Encre</span>
              <span className="flex gap-1">
                {INK.map((c) => (
                  <button
                    key={c}
                    type="button"
                    title={`Encre ${c}`}
                    aria-label={`Encre ${c}`}
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
                  title="Autre couleur"
                  aria-label="Autre couleur d’encre"
                  className="h-5 w-5 cursor-pointer rounded-full border border-border bg-transparent p-0"
                />
              </span>
              <NumberField
                label="Épaisseur"
                value={ann.penWidth}
                onChange={ann.setPenWidth}
                min={1}
                max={24}
                step={1}
                unit="px"
              />
              <NumberField
                label="Opacité"
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
            <span className="rv-optbar__hint">
              Cliquer une forme du tracé en cours. Les tracés déjà envoyés ne sont plus modifiables.
            </span>
          )}
          <span className="rv-rule" />
          <IconButton
            icon={Undo2}
            label="Annuler le dernier tracé"
            bordered
            onClick={ann.undo}
            disabled={!ann.canUndo}
          />
          <IconButton icon={Redo2} label="Rétablir" bordered onClick={ann.redo} disabled={!ann.canRedo} />
          <IconButton
            icon={Eraser}
            label="Tout effacer"
            bordered
            onClick={ann.clear}
            disabled={ann.annot.length === 0}
          />
          <span className="rv-optbar__hint">
            {ann.annot.length > 0
              ? `${ann.annot.length} forme${ann.annot.length > 1 ? 's' : ''} jointe${ann.annot.length > 1 ? 's' : ''} au commentaire.`
              : 'Le tracé part avec le commentaire.'}
          </span>
        </>
      )}

      {id === 'wipe' && compare && (
        <>
          {compare.hasB ? (
            <SegmentedControl
              label="Mode de comparaison"
              items={COMPARE_MODES}
              value={compare.mode}
              onChange={compare.onMode}
            />
          ) : (
            <span className="rv-optbar__hint">
              Choisir une version B dans le dock Comparaison pour activer le wipe.
            </span>
          )}
        </>
      )}

      {(id === 'in' || id === 'out') && trim && (
        <>
          <span className="rv-optbar__hint">{trim.label}</span>
          <span className="rv-rule" />
          <Button size="sm" variant="outline" onClick={trim.onIn}>
            <LogIn size={13} />
            Entrée ici
          </Button>
          <Button size="sm" variant="outline" onClick={trim.onOut}>
            <LogOut size={13} />
            Sortie ici
          </Button>
          <IconButton
            icon={X}
            label="Effacer le découpage"
            bordered
            onClick={trim.onClear}
            disabled={trim.inFrame == null && trim.outFrame == null}
          />
        </>
      )}

      {id === 'range' && (
        <>
          <span className="rv-optbar__hint">
            Poser les bornes de boucle sur la timeline : le commentaire couvrira toute la plage.
          </span>
          <span className="rv-rule" />
          <Badge variant="secondary">Plage jointe au prochain commentaire</Badge>
        </>
      )}
    </OptionsBar>
  );
}

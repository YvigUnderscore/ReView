import { useEffect, type ReactNode } from 'react';
import type { MediaResp, SplatTransform } from '../reviewTypes';
import type { SplatViewer } from './useSplat';
import { useSplatEditor } from './editor/useSplatEditor';
import SplatEditorToolbar from './editor/SplatEditorToolbar';
import SelectionOverlay from './editor/selection/SelectionOverlay';
import VolumesBar from './editor/volumes/VolumesBar';
import SplatPane from './SplatPane';

/**
 * Bloc splat de la review (10.G) : orchestre le viewer (SplatPane) et l'éditeur avant
 * publication (toolbar + gizmos + sélection). Extrait de ReviewViewer pour garder tout le
 * domaine splat sous `splat/` — ReviewViewer ne fait que monter ce composant. L'état éditeur
 * vit dans `useSplatEditor` ; en lecture seule, la transformation enregistrée est appliquée ici.
 */
export default function SplatReview({
  data,
  splat,
  showEdit,
  saved,
  onSaved,
  overlay,
}: {
  data: MediaResp;
  splat: SplatViewer;
  /** Éditeur monté (média non publié + gestionnaire + viewer prêt). */
  showEdit: boolean;
  saved: SplatTransform | null;
  onSaved: (t: SplatTransform | null) => void;
  overlay: ReactNode;
}) {
  const editor = useSplatEditor(splat, data.media.id, saved, onSaved, showEdit);
  const { applyTransform, ready, getSceneHandle } = splat;

  // Lecture seule : applique la transformation enregistrée (l'éditeur la gère sinon).
  useEffect(() => {
    if (!showEdit && ready) applyTransform(saved);
  }, [showEdit, ready, applyTransform, saved]);

  const selectTool = editor.tool === 'select-rect' ? 'rect' : editor.tool === 'select-lasso' ? 'lasso' : null;

  return (
    <>
      {showEdit && (
        <SplatEditorToolbar
          tool={editor.tool}
          onTool={editor.setTool}
          renderMode={editor.renderMode}
          onRenderMode={editor.setRenderMode}
          selectedCount={editor.selection.selected.size}
          onClearSelection={editor.selection.clear}
          deletedCount={editor.deletedCount}
          onDelete={editor.deleteSelection}
          canUndo={editor.history.canUndo}
          canRedo={editor.history.canRedo}
          onUndo={editor.history.undo}
          onRedo={editor.history.redo}
          dirty={editor.dirty}
          busy={editor.busy}
          onSave={() => void editor.save()}
          onReset={() => void editor.reset()}
        />
      )}
      {showEdit && <VolumesBar volumes={editor.volumes} />}
      <SplatPane
        containerRef={splat.containerRef}
        ready={splat.ready}
        loadError={splat.loadError}
        status={data.media.status}
        overlay={overlay}
        editorOverlay={
          showEdit && selectTool && ready ? (
            <SelectionOverlay
              tool={selectTool}
              getCanvas={() => getSceneHandle()?.dom ?? null}
              onCommit={editor.selection.commitShape}
            />
          ) : null
        }
      />
    </>
  );
}

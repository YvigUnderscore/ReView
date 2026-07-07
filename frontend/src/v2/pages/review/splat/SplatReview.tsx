import { useEffect, type ReactNode } from 'react';
import type { MediaResp, SplatEditsPatch } from '../reviewTypes';
import type { SplatViewer } from './useSplat';
import { useSplatEditor } from './editor/useSplatEditor';
import SplatEditorToolbar from './editor/SplatEditorToolbar';
import { applyMaskIndices, applySavedVolumes, fetchMaskIndices } from './editor/persistence/applyEdits';
import SelectionOverlay from './editor/selection/SelectionOverlay';
import { disposeVolume, type VolumeRuntime } from './editor/volumes/cropVolume';
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
  onSaved,
  overlay,
}: {
  data: MediaResp;
  splat: SplatViewer;
  /** Éditeur monté (média non publié + gestionnaire + viewer prêt). */
  showEdit: boolean;
  onSaved: (patch: SplatEditsPatch) => void;
  overlay: ReactNode;
}) {
  const saved = data.splatEdits;
  const editor = useSplatEditor(splat, data.media.id, saved, data.splatMaskUrl, onSaved, showEdit);
  const { applyTransform, ready, getSceneHandle } = splat;

  // Lecture seule : applique la transformation enregistrée (l'éditeur la gère sinon).
  const savedTransform = saved?.transform ?? null;
  useEffect(() => {
    if (!showEdit && ready) applyTransform(savedTransform);
  }, [showEdit, ready, applyTransform, savedTransform]);

  // Lecture seule : applique volumes de crop (sans filaire) et masque de suppression —
  // les éditions comptent pour tous les spectateurs, pas seulement l'éditeur.
  const savedVolumes = saved?.volumes ?? null;
  const maskUrl = data.splatMaskUrl;
  useEffect(() => {
    if (showEdit || !ready) return;
    const handle = getSceneHandle();
    if (!handle) return;
    let disposed = false;
    let created: VolumeRuntime[] = [];
    void (async () => {
      if (savedVolumes?.length) {
        created = await applySavedVolumes(handle, savedVolumes, false);
        if (disposed) created.forEach(disposeVolume);
      }
      if (maskUrl) {
        const indices = await fetchMaskIndices(maskUrl).catch(() => []);
        if (!disposed && indices.length) applyMaskIndices(handle, indices);
      }
    })();
    return () => {
      disposed = true;
      created.forEach(disposeVolume);
    };
  }, [showEdit, ready, getSceneHandle, savedVolumes, maskUrl]);

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

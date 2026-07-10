import { Gauge, Settings2 } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import type { MediaResp, SplatEditsPatch } from '../reviewTypes';
import type { SplatViewer } from './useSplat';
import CameraBar from './camera/CameraBar';
import KeyframeTimeline from './camera/KeyframeTimeline';
import CompareBar from './compare/CompareBar';
import { useSplatCompare } from './compare/useSplatCompare';
import PaintBar from './paint/PaintBar';
import PaintOverlay from './paint/PaintOverlay';
import type { SplatPaintState } from './paint/useSplatPaint';
import { usePresentation } from './presentation/usePresentation';
import { useSplatEditor } from './editor/useSplatEditor';
import SplatEditorToolbar from './editor/SplatEditorToolbar';
import { applyMaskIndices, applySavedVolumes, fetchMaskIndices } from './editor/persistence/applyEdits';
import SelectionOverlay from './editor/selection/SelectionOverlay';
import { disposeVolume, type VolumeRuntime } from './editor/volumes/cropVolume';
import VolumesBar from './editor/volumes/VolumesBar';
import StatsPanel from './hud/StatsPanel';
import TransformFields from './hud/TransformFields';
import ViewerHud, { HudGroup, HudIconButton } from './hud/ViewerHud';
import ViewerSettingsPanel from './hud/ViewerSettingsPanel';
import SplatPane from './SplatPane';

/**
 * Bloc splat de la review (10.G) : orchestre le viewer (SplatPane), le HUD flottant (stats,
 * réglages — 10.G-V1) et l'éditeur avant publication (toolbar + gizmos + sélection), superposés
 * au canvas façon logiciel 3D. Extrait de ReviewViewer pour garder tout le domaine splat sous
 * `splat/` — ReviewViewer ne fait que monter ce composant. L'état éditeur vit dans
 * `useSplatEditor` ; en lecture seule, la transformation enregistrée est appliquée ici.
 */
export default function SplatReview({
  data,
  splat,
  showEdit,
  canPresent,
  paint,
  onSaved,
  overlay,
}: {
  data: MediaResp;
  splat: SplatViewer;
  /** Éditeur monté (média non publié + gestionnaire + viewer prêt). */
  showEdit: boolean;
  /** Gestionnaire : peut persister la présentation (autorisé même publié — mise en scène). */
  canPresent: boolean;
  /** Painter 3D (V9) — instancié par la page (les traits partent avec le commentaire). */
  paint: SplatPaintState;
  onSaved: (patch: SplatEditsPatch) => void;
  overlay: ReactNode;
}) {
  const saved = data.splatEdits;
  const editor = useSplatEditor(splat, data.media.id, saved, data.splatMaskUrl, onSaved, showEdit);
  const { applyTransform, ready, getSceneHandle, setCullingOff } = splat;

  // Panneaux du HUD (état local de session — réglages spectateur non persistés).
  const [showStats, setShowStats] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [cullingOff, setCullingOffState] = useState(true);
  const onCullingOff = (off: boolean) => {
    setCullingOffState(off);
    setCullingOff(off);
  };

  // Présentation (V5/V6) : caméra (rig + keyframes), reveal, debug color — rejouée pour tous.
  const pres = usePresentation(splat, data, onSaved);
  // Comparaison (V8) : autres splats de la même version — switch A/B + « voir tous ».
  const compare = useSplatCompare(splat, data.media);

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

  const selectTool =
    editor.tool === 'select-rect'
      ? ('rect' as const)
      : editor.tool === 'select-lasso'
        ? ('lasso' as const)
        : editor.tool === 'brush'
          ? ('brush' as const)
          : null;

  return (
    <SplatPane
      containerRef={splat.containerRef}
      ready={splat.ready}
      loadError={splat.loadError}
      status={data.media.status}
      overlay={overlay}
      editorOverlay={
        paint.active && ready ? (
          <PaintOverlay
            color={paint.color}
            getCanvas={() => getSceneHandle()?.dom ?? null}
            onStroke={paint.addStroke}
          />
        ) : showEdit && selectTool && ready ? (
          <SelectionOverlay
            tool={selectTool}
            brushRadius={editor.brushRadius}
            getCanvas={() => getSceneHandle()?.dom ?? null}
            onCommit={editor.selection.commitShape}
            onBrush={(point, combine, viewport) =>
              editor.selection.commitBrush(point, editor.brushRadius, combine, viewport)
            }
          />
        ) : null
      }
      hud={
        ready ? (
          <ViewerHud
            topLeft={
              showEdit ? (
                <>
                  <SplatEditorToolbar
                    tool={editor.tool}
                    onTool={editor.setTool}
                    brushRadius={editor.brushRadius}
                    onBrushRadius={editor.setBrushRadius}
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
                  <VolumesBar volumes={editor.volumes} />
                  <TransformFields
                    label={editor.fields.label}
                    value={editor.fields.value}
                    onCommit={editor.fields.commit}
                  />
                </>
              ) : undefined
            }
            topRight={
              <>
                <HudGroup>
                  <HudIconButton
                    icon={Gauge}
                    hint="Statistiques de rendu (FPS, splats, draw calls)"
                    active={showStats}
                    onClick={() => setShowStats((v) => !v)}
                  />
                  <HudIconButton
                    icon={Settings2}
                    hint="Réglages du viewer (culling…)"
                    active={showSettings}
                    onClick={() => setShowSettings((v) => !v)}
                  />
                </HudGroup>
                {showStats && <StatsPanel splat={splat} />}
                {showSettings && (
                  <ViewerSettingsPanel
                    cullingOff={cullingOff}
                    onCullingOff={onCullingOff}
                    debugMode={pres.debugMode}
                    onDebugMode={pres.setDebugMode}
                    reveal={pres.reveal}
                    onReveal={pres.setReveal}
                    onReplayReveal={pres.replayReveal}
                    lodMode={pres.lodMode}
                    onLodMode={pres.setLodMode}
                  />
                )}
              </>
            }
            bottomLeft={
              <>
                {!showEdit && compare.enabled && <CompareBar compare={compare} />}
                <PaintBar paint={paint} />
                <CameraBar rig={pres.rig} kf={pres.kf} />
                {canPresent && (
                  <KeyframeTimeline
                    kf={pres.kf}
                    onOrbitPreset={pres.applyOrbitPreset}
                    onSave={() => void pres.save()}
                    onClear={() => void pres.clear()}
                    busy={pres.busy}
                  />
                )}
              </>
            }
          />
        ) : null
      }
    />
  );
}

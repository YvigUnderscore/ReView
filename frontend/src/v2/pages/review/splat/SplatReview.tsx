import { Gauge, Grid3x3, Settings2 } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import type { MediaResp, SplatEditsPatch } from '../reviewTypes';
import type { Annotations } from '../useAnnotations';
import type { SplatViewer } from './useSplat';
import { frameCameraToMesh } from './scene/frameCamera';
import { frameCameraToSphere } from '../viewer/frameCamera';
import { useFrameShortcuts } from '../viewer/useFrameShortcuts';
import { useSceneGrid } from '../viewer/useSceneGrid';
import { meshBounds, selectionBounds } from './editor/selection/bounds';
import { importCameraFromGltf } from '../three/importCameraGltf';
import CameraBar from '../camera/CameraBar';
import AnimPanel from '../camera/timeline/AnimPanel';
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
import ViewerHud, { HudGroup, HudIconButton } from '../hud/ViewerHud';
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
  ann,
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
  /** Annotations (mode layout : joindre/rejouer une animation caméra dans les commentaires). */
  ann: Annotations;
}) {
  const saved = data.splatEdits;
  const editor = useSplatEditor(splat, data.media.id, saved, data.splatMaskUrl, onSaved, showEdit);
  const { applyTransform, setBaseFlip, ready, getSceneHandle, setCullingOff } = splat;

  // Panneaux du HUD (état local de session — réglages spectateur non persistés).
  const [showStats, setShowStats] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  // Grille de sol (repère d'orientation de la scène) — togglable, préférence locale.
  const grid = useSceneGrid(splat);
  const [cullingOff, setCullingOffState] = useState(true);
  const onCullingOff = (off: boolean) => {
    setCullingOffState(off);
    setCullingOff(off);
  };

  // Présentation (V5/V6) : caméra (rig + keyframes), reveal, debug color — rejouée pour tous.
  const pres = usePresentation(splat, data, onSaved);
  // Comparaison (V8) : autres splats de la même version — switch A/B + « voir tous ».
  const compare = useSplatCompare(splat, data.media);

  // Mode layout : rejoue l'animation caméra jointe au commentaire sélectionné.
  const { setAnim: animSetAnim, play: animPlay } = pres.anim;
  const viewedCameraAnim = ann.viewedCameraAnim;
  useEffect(() => {
    if (viewedCameraAnim) {
      animSetAnim(viewedCameraAnim);
      animPlay();
    }
  }, [viewedCameraAnim, animSetAnim, animPlay]);

  const attachLayout = useCallback(() => {
    if (!pres.anim.hasAnimation) return;
    ann.setCameraAnim(pres.anim.anim);
    toast.success('Animation caméra jointe au prochain commentaire');
  }, [pres.anim, ann]);

  const importLayout = useCallback(
    (file: File) => {
      void importCameraFromGltf(file)
        .then((animData) => {
          if (!animData) {
            toast.error('Aucune animation caméra dans ce fichier');
            return;
          }
          pres.anim.setAnim(animData);
          pres.anim.play();
          toast.success('Animation caméra importée');
        })
        .catch(() => toast.error('Import caméra impossible'));
    },
    [pres.anim],
  );

  // Lecture seule : applique la transformation et le flip d'orientation enregistrés
  // (l'éditeur les gère sinon).
  const savedTransform = saved?.transform ?? null;
  const savedFlip = saved?.baseFlip ?? true;
  useEffect(() => {
    if (!showEdit && ready) {
      applyTransform(savedTransform);
      setBaseFlip(savedFlip);
    }
  }, [showEdit, ready, applyTransform, savedTransform, setBaseFlip, savedFlip]);

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

  // Cadrage F/H, actif pour **tous** (y compris en review post-publish) : F cadre la sélection
  // si présente (édition), sinon le splat visible ; H rétablit la vue d'origine.
  const selectedSet = editor.selection.selected;
  const frameView = useCallback(() => {
    const handle = getSceneHandle();
    if (!handle) return;
    const bounds = (selectedSet.size ? selectionBounds(handle, selectedSet) : null) ?? meshBounds(handle);
    if (bounds) frameCameraToSphere(handle.camera, handle.controls, bounds.center, bounds.radius);
  }, [getSceneHandle, selectedSet]);
  const homeView = useCallback(() => {
    const handle = getSceneHandle();
    if (handle) frameCameraToMesh(handle.THREE, handle.mesh, handle.camera, handle.controls);
  }, [getSceneHandle]);

  // Raccourcis F/H côté viewer (post-publish). En édition, l'éditeur gère déjà F/H (sélection).
  useFrameShortcuts({
    active: !showEdit && ready,
    isFlying: splat.isFlying,
    onFrame: frameView,
    onHome: homeView,
  });

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
      aspect={data.splatPresentation?.camera?.aspect}
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
                    baseFlip={editor.baseFlip}
                    onToggleFlip={editor.toggleBaseFlip}
                    dirty={editor.dirty}
                    busy={editor.busy}
                    onSave={() => void editor.save()}
                    onReset={() => void editor.reset()}
                  />
                  <VolumesBar volumes={editor.volumes} />
                  <TransformFields
                    label={editor.fields.label}
                    shape={editor.fields.shape}
                    value={editor.fields.value}
                    onCommit={editor.fields.commit}
                    gizmo={editor.gizmo}
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
                  <HudIconButton
                    icon={Grid3x3}
                    hint="Grille de sol (repère d'orientation de la scène)"
                    active={grid.visible}
                    onClick={grid.toggle}
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
                {compare.enabled && <CompareBar compare={compare} />}
                <PaintBar paint={paint} />
                <CameraBar
                  fov={pres.rig.fov}
                  onFov={pres.rig.setFov}
                  roll={pres.rig.roll}
                  onRoll={pres.rig.setRoll}
                  onFrame={frameView}
                  onHome={homeView}
                  kf={pres.anim}
                  dof={{
                    aperture: pres.rig.aperture,
                    onAperture: pres.rig.setAperture,
                    focusPick: pres.rig.focusPick,
                    onToggleFocusPick: pres.rig.toggleFocusPick,
                  }}
                />
                <AnimPanel
                  anim={pres.anim}
                  onOrbitPreset={pres.applyOrbitPreset}
                  onSave={canPresent ? () => void pres.save() : undefined}
                  onClear={canPresent ? () => void pres.clear() : undefined}
                  busy={pres.busy}
                  onAttach={attachLayout}
                  onImport={importLayout}
                  editable={canPresent}
                />
              </>
            }
          />
        ) : null
      }
    />
  );
}

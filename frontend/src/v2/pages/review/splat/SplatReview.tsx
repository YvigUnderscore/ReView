import { Gauge, Settings2 } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { api } from '../../../../lib/apiClient';
import type { MediaResp, SplatEditsPatch, SplatPresentation } from '../reviewTypes';
import type { SplatViewer } from './useSplat';
import CameraBar from './camera/CameraBar';
import { orbitPreset } from './camera/cameraAnim';
import KeyframeTimeline from './camera/KeyframeTimeline';
import { useCameraKeyframes } from './camera/useCameraKeyframes';
import { useCameraRig } from './camera/useCameraRig';
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
  onSaved,
  overlay,
}: {
  data: MediaResp;
  splat: SplatViewer;
  /** Éditeur monté (média non publié + gestionnaire + viewer prêt). */
  showEdit: boolean;
  /** Gestionnaire : peut persister la présentation (autorisé même publié — mise en scène). */
  canPresent: boolean;
  onSaved: (patch: SplatEditsPatch) => void;
  overlay: ReactNode;
}) {
  const saved = data.splatEdits;
  const editor = useSplatEditor(splat, data.media.id, saved, data.splatMaskUrl, onSaved, showEdit);
  const { applyTransform, ready, getSceneHandle, setCullingOff, captureCamera } = splat;

  // Panneaux du HUD (état local de session — réglages spectateur non persistés).
  const [showStats, setShowStats] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [cullingOff, setCullingOffState] = useState(true);
  const onCullingOff = (off: boolean) => {
    setCullingOffState(off);
    setCullingOff(off);
  };

  // Caméra (V5) : animation keyframe + réglages fov/DoF, présentation rejouée pour tous.
  const kf = useCameraKeyframes(splat);
  const rig = useCameraRig(splat, data.splatPresentation, kf);
  const [presBusy, setPresBusy] = useState(false);

  /** Enregistre la présentation : vue courante + DoF + animation (gestionnaire). */
  const savePresentation = async () => {
    setPresBusy(true);
    try {
      const view = captureCamera();
      const presentation: SplatPresentation = {};
      if (view) presentation.camera = { position: view.position, target: view.target, fov: view.fov };
      if (rig.aperture > 0)
        presentation.dof = { focalDistance: rig.focalDistance(), apertureAngle: rig.aperture };
      if (kf.keyframes.length >= 2) presentation.cameraAnim = { keyframes: kf.keyframes, loop: kf.loop };
      const { splatPresentation } = await api.patch<{ splatPresentation: SplatPresentation | null }>(
        `/api/media/${data.media.id}/splat-presentation`,
        { presentation },
      );
      onSaved({ splatPresentation });
      toast.success('Présentation enregistrée — rejouée pour tous à l’ouverture');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur à l'enregistrement de la présentation");
    } finally {
      setPresBusy(false);
    }
  };

  /** Efface la présentation persistée (retour au cadrage automatique). */
  const clearPresentation = async () => {
    setPresBusy(true);
    try {
      await api.patch(`/api/media/${data.media.id}/splat-presentation`, { presentation: null });
      onSaved({ splatPresentation: null });
      kf.setAll([], true);
      toast.success('Présentation effacée');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur à l'effacement de la présentation");
    } finally {
      setPresBusy(false);
    }
  };

  /** Preset orbite : un tour complet autour de la cible courante, en boucle. */
  const applyOrbitPreset = () => {
    const view = captureCamera();
    if (!view) return;
    kf.setAll(orbitPreset(view), true);
    kf.play();
  };

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
        showEdit && selectTool && ready ? (
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
                {showSettings && <ViewerSettingsPanel cullingOff={cullingOff} onCullingOff={onCullingOff} />}
              </>
            }
            bottomLeft={
              <>
                <CameraBar rig={rig} kf={kf} />
                {canPresent && (
                  <KeyframeTimeline
                    kf={kf}
                    onOrbitPreset={applyOrbitPreset}
                    onSave={() => void savePresentation()}
                    onClear={() => void clearPresentation()}
                    busy={presBusy}
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

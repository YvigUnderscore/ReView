import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import type { Role } from '../../../types/api';
import type { MediaResp, SplatEditsPatch } from '../reviewTypes';
import type { Annotations } from '../useAnnotations';
import type { SplatViewer } from './useSplat';
import { frameCameraToMesh } from './scene/frameCamera';
import { frameCameraToSphere } from '../viewer/frameCamera';
import { useFrameShortcuts } from '../viewer/useFrameShortcuts';
import { useSceneGrid } from '../viewer/useSceneGrid';
import { meshBounds, selectionBounds } from './editor/selection/bounds';
import { importCameraFile } from '../three/importCameraAbc';
import { useCameraSceneRig } from '../camera/sceneRig/useCameraSceneRig';
import PipFrame from '../viewer/PipFrame';
import { DEFAULT_REVIEW_ASPECT } from '../frameRect';
import CompareControl from './compare/CompareControl';
import { useSplatCompare } from './compare/useSplatCompare';
import PaintOverlay from './paint/PaintOverlay';
import type { SplatPaintState } from './paint/useSplatPaint';
import { usePresentation } from './presentation/usePresentation';
import { useSplatEditor } from './editor/useSplatEditor';
import { applyMaskIndices, applySavedVolumes, fetchMaskIndices } from './editor/persistence/applyEdits';
import { applySubsetOps, fetchSubsetOps } from './editor/persistence/subsetOps';
import SelectionOverlay from './editor/selection/SelectionOverlay';
import { disposeVolume, type VolumeRuntime } from './editor/volumes/cropVolume';
import ReviewChrome from '../chrome/ReviewChrome';
import { useChromeState } from '../chrome/useChromeState';
import { toolsFor } from '../chrome/tools';
import SplatOptions from '../options/SplatOptions';
import SpatialTransport from '../transport/SpatialTransport';
import CurvesDrawer from '../transport/CurvesDrawer';
import SplatPanels from './SplatPanels';
import { SPLAT_HIDDEN_TOOLS, useSplatChrome } from './useSplatChrome';
import SplatPane from './SplatPane';

/**
 * Bloc splat de la review, monté dans le chrome unifié : rail d'outils à gauche, options de
 * l'outil armé sous l'en-tête, dock inspecteur à droite, transport de l'animation caméra en
 * bas. Plus rien ne flotte au-dessus du nuage — seuls restent les overlays ancrés à la vue
 * (tracés du painter, tracé de sélection, PiP de la caméra layout).
 *
 * L'état métier n'a pas bougé : `useSplatEditor` porte l'édition, `usePresentation` la mise
 * en scène, `useSplatCompare` l'A/B. Le rail se contente d'armer l'outil ; `useSplatChrome`
 * fait suivre les hooks.
 */
export default function SplatReview({
  data,
  splat,
  showEdit,
  canPresent,
  paint,
  onSaved,
  role,
  overlay,
  ann,
}: {
  data: MediaResp;
  splat: SplatViewer;
  /** Éditeur monté (média non publié + gestionnaire + viewer prêt). */
  showEdit: boolean;
  /** Gestionnaire : peut persister la présentation (autorisé même publié — mise en scène). */
  canPresent: boolean;
  /** Painter 3D — instancié par la page (les traits partent avec le commentaire). */
  paint: SplatPaintState;
  onSaved: (patch: SplatEditsPatch) => void;
  /** Rôle du spectateur — le client ne voit pas la bascule de mode. */
  role?: Role;
  overlay: ReactNode;
  /** Annotations (mode layout : joindre/rejouer une animation caméra dans les commentaires). */
  ann: Annotations;
}) {
  const saved = data.splatEdits;
  const editor = useSplatEditor(
    splat,
    data.media.id,
    saved,
    data.splatMaskUrl,
    data.splatSubsetUrl,
    onSaved,
    showEdit,
  );
  const { applyTransform, setBaseFlip, ready, getSceneHandle } = splat;

  const grid = useSceneGrid(splat);
  const pres = usePresentation(splat, data, onSaved);
  const compare = useSplatCompare(splat, data.media);
  const { state, update } = useChromeState('SPLAT');
  // Culling Spark neutralisé par défaut : rien ne disparaît en zoom fort (réglage de session).
  const [cullingOff, setCullingOffState] = useState(true);
  const onCullingOff = useCallback(
    (off: boolean) => {
      setCullingOffState(off);
      splat.setCullingOff(off);
    },
    [splat],
  );

  // Caméra-objet dans la scène (mode layout) : mesh + trajectoire + gizmo des clés.
  const cameraRig = useCameraSceneRig({
    getSceneHandle: splat.getSceneHandle,
    subscribeFrame: splat.subscribeFrame,
    ready: splat.ready,
    active: pres.layout.layoutMode,
    editable: canPresent,
    anim: pres.anim,
  });

  useSplatChrome({
    state,
    editor,
    paint,
    focusPick: pres.rig.focusPick,
    onToggleFocusPick: pres.rig.toggleFocusPick,
    cameraRig,
  });

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
      void importCameraFile(file)
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

  // Lecture seule : applique volumes de crop (sans filaire), masque de suppression et
  // transformations de sous-ensembles — les éditions comptent pour tous les spectateurs.
  const savedVolumes = saved?.volumes ?? null;
  const maskUrl = data.splatMaskUrl;
  const subsetUrl = data.splatSubsetUrl;
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
      if (subsetUrl) {
        const ops = await fetchSubsetOps(subsetUrl).catch(() => []);
        if (!disposed && ops.length) applySubsetOps(handle, ops);
      }
    })();
    return () => {
      disposed = true;
      created.forEach(disposeVolume);
    };
  }, [showEdit, ready, getSceneHandle, savedVolumes, maskUrl, subsetUrl]);

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

  const activeTool =
    toolsFor(state.mode, 'SPLAT').find((t) => t.id === state.tool) ?? toolsFor(state.mode, 'SPLAT')[0]!;

  return (
    <ReviewChrome
      kind="SPLAT"
      state={state}
      onState={update}
      role={role ?? 'ARTIST'}
      hiddenTools={SPLAT_HIDDEN_TOOLS}
      headerRight={compare.enabled ? <CompareControl compare={compare} /> : undefined}
      dirty={showEdit ? editor.dirty : undefined}
      onViewAction={(action) => (action === 'fit' ? frameView() : homeView())}
      options={
        <SplatOptions
          tool={activeTool}
          mode={state.mode}
          editor={editor}
          paint={paint}
          presentation={
            canPresent
              ? { dirty: pres.anim.hasAnimation, busy: pres.busy, onSave: () => void pres.save() }
              : undefined
          }
          onPlaceHotspot={() => ann.setHotspot3d(splat.raycastCenter())}
        />
      }
      panel={
        <SplatPanels
          panel={state.panel}
          data={data}
          splat={splat}
          pres={pres}
          editor={editor}
          showEdit={showEdit}
          compare={compare}
          grid={grid}
          culling={{ off: cullingOff, onOff: onCullingOff }}
          exportEdits={
            // Éditions effectives à cuire dans l'export : celles de l'éditeur en cours
            // d'édition, sinon celles persistées (rejouées pour tous) en lecture seule.
            showEdit
              ? { transform: editor.transform, volumes: editor.volumes.serialize() }
              : { transform: saved?.transform ?? null, volumes: saved?.volumes ?? [] }
          }
          onFrame={frameView}
          onHome={homeView}
          onImportAnim={importLayout}
        />
      }
      transport={
        <SpatialTransport
          anim={pres.anim}
          editable={canPresent}
          onAttach={attachLayout}
          drawerOpen={state.drawer === 'curves'}
          onDrawer={() => update({ drawer: state.drawer === 'curves' ? null : 'curves' })}
        />
      }
      drawer={state.drawer === 'curves' ? <CurvesDrawer anim={pres.anim} editable={canPresent} /> : undefined}
    >
      <SplatPane
        containerRef={splat.containerRef}
        ready={splat.ready}
        loadError={splat.loadError}
        progress={splat.progress}
        status={data.media.status}
        aspect={data.splatPresentation?.camera?.aspect}
        overlay={overlay}
        pip={
          pres.layout.layoutMode && ready ? (
            <PipFrame
              label="Caméra layout"
              aspect={data.splatPresentation?.camera?.aspect ?? DEFAULT_REVIEW_ASPECT}
              onRect={splat.setPipRect}
            />
          ) : undefined
        }
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
      />
    </ReviewChrome>
  );
}

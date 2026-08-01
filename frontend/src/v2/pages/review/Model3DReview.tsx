import { useState, type ReactNode } from 'react';
import type { MediaResp, SplatEditsPatch } from './reviewTypes';
import type { Annotations } from './useAnnotations';
import type { Model3DThreeState } from './three/useModel3DThree';
import type { Role } from '../../types/api';
import { useModel3DCamera } from './three/useModel3DCamera';
import { useModel3DLighting } from './three/useModel3DLighting';
import { useModel3DInspect } from './three/useModel3DInspect';
import { useModel3DVariants } from './three/useModel3DVariants';
import { useModel3DBookmarks } from './three/useModel3DBookmarks';
import { useTurntable } from './three/useTurntable';
import { useSectionPlane } from './three/useSectionPlane';
import { useModel3DCompare } from './three/useModel3DCompare';
import { useCameraSceneRig } from './camera/sceneRig/useCameraSceneRig';
import { useSceneGrid } from './viewer/useSceneGrid';
import Model3DThreePane from './Model3DThreePane';
import Model3DCompareBar from './Model3DCompareBar';
import Model3DPanels from './three/Model3DPanels';
import { MODEL_HIDDEN_TOOLS, useModel3DChrome } from './three/useModel3DChrome';
import Model3DOptions from './options/Model3DOptions';
import ReviewChrome from './chrome/ReviewChrome';
import { useChromeState } from './chrome/useChromeState';
import { toolsFor } from './chrome/tools';
import SpatialTransport from './transport/SpatialTransport';
import ClipTransport from './transport/ClipTransport';
import CurvesDrawer from './transport/CurvesDrawer';
import TrackSwitch, { type TrackId } from './transport/TrackSwitch';
import PipFrame from './viewer/PipFrame';
import UsdRecomposeDialog from './UsdRecomposeDialog';
import { useUsdScene } from './three/useUsdScene';
import { useUsdPicking } from './three/useUsdPicking';
import { DEFAULT_REVIEW_ASPECT } from './frameRect';

/**
 * Bloc modèle 3D de la review, monté dans le chrome unifié — mêmes cinq emplacements que le
 * splat, avec un panneau Éclairage en plus (un modèle s'éclaire, un nuage porte sa lumière).
 * Les onze barres flottantes de l'ancien HUD sont réparties entre le rail (gizmos, épingle,
 * caméra-objet), la barre d'options, les six panneaux du dock et le transport à deux pistes.
 */
export default function Model3DReview({
  data,
  model3d,
  ann,
  canManage,
  showEditTools,
  role,
  reprocessing,
  onReprocess,
  onSaved,
  overlay,
  ready,
}: {
  data: MediaResp;
  model3d: Model3DThreeState;
  ann: Annotations;
  canManage: boolean;
  /** Édition de la transformation (pré-publish + droits) — gizmo TRS. */
  showEditTools: boolean;
  role?: Role;
  reprocessing: boolean;
  onReprocess: () => void;
  onSaved: (patch: SplatEditsPatch) => void;
  overlay: ReactNode;
  /** Modèle chargé et affichable (chrome monté seulement alors). */
  ready: boolean;
}) {
  const cam = useModel3DCamera(model3d, data, canManage, onSaved, ann);
  // Éclairage HDRI : défaut rejoué pour tous, tweak spectateur temporaire.
  const lighting = useModel3DLighting(model3d, data, canManage, onSaved);
  // Inspection : modes d'affichage + fiche technique — local à la session.
  const inspect = useModel3DInspect(model3d);
  // Variantes de matériaux + caméras embarquées — local à la session.
  const variants = useModel3DVariants(model3d);
  // Bookmarks caméra partagés : vues nommées rejouées pour tous.
  const bookmarks = useModel3DBookmarks(model3d, data, canManage, onSaved);
  // Turntable + plan de coupe : prévisualisations d'inspection session-local.
  const turntable = useTurntable(model3d);
  const section = useSectionPlane(model3d);
  // Comparaison A/B des modèles 3D d'une version : caméra liée (même scène).
  const compare = useModel3DCompare(model3d, data.media);
  // Scenegraph USD + « ReView override » (46.C) : l'override de base du média est rejoué pour
  // tous, l'exploration locale du spectateur reste dans sa session.
  const scene = useUsdScene(data, model3d, ready, null);
  useUsdPicking(model3d, ready, scene.select);
  // Recomposition USD : réservée aux gestionnaires, refusée après publication (verrou P11).
  const [recomposeOpen, setRecomposeOpen] = useState(false);
  const usd = data.modelSource?.usd ?? null;
  const canRecompose = canManage && !data.media.published && !!usd;
  const grid = useSceneGrid(model3d);
  const [track, setTrack] = useState<TrackId>('camera');

  // Caméra-objet dans la scène (mode layout) : mesh + trajectoire + gizmo d'édition des clés.
  const rig = useCameraSceneRig({
    getSceneHandle: model3d.getSceneHandle,
    subscribeFrame: model3d.subscribeFrame,
    ready,
    active: model3d.layoutMode,
    editable: canManage,
    anim: cam.anim,
  });

  const { state, update } = useChromeState('MODEL_3D');
  const { history, dirty } = useModel3DChrome({ state, m: model3d, cameraRig: rig });

  const tools = toolsFor(state.mode, 'MODEL_3D');
  const activeTool = tools.find((t) => t.id === state.tool) ?? tools[0]!;
  const trackSwitch = (
    <TrackSwitch track={track} onTrack={setTrack} hasClips={model3d.animations.length > 0} />
  );

  return (
    <ReviewChrome
      kind="MODEL_3D"
      state={state}
      onState={update}
      role={role ?? 'ARTIST'}
      hiddenTools={MODEL_HIDDEN_TOOLS}
      headerRight={compare.enabled && !showEditTools ? <Model3DCompareBar compare={compare} /> : undefined}
      dirty={showEditTools ? dirty : undefined}
      onViewAction={(action) => (action === 'fit' ? model3d.frameView() : model3d.homeView())}
      options={
        <Model3DOptions
          tool={activeTool}
          mode={state.mode}
          m={model3d}
          history={history}
          dirty={dirty}
          canEdit={showEditTools}
          onPlaceHotspot={() => ann.setHotspot3d(model3d.hotspotAtCenter())}
          presentation={canManage ? { busy: cam.busy, onSave: () => cam.save?.() } : undefined}
        />
      }
      panel={
        <Model3DPanels
          panel={state.panel}
          data={data}
          m={model3d}
          anim={cam.anim}
          lighting={lighting}
          inspect={inspect}
          variants={variants}
          bookmarks={bookmarks}
          turntable={turntable}
          section={section}
          grid={grid}
          scene={scene}
          onRecompose={canRecompose ? () => setRecomposeOpen(true) : undefined}
          onImportAnim={canManage ? cam.importGltf : undefined}
        />
      }
      transport={
        track === 'clip' ? (
          <ClipTransport m={model3d} trackSwitch={trackSwitch} />
        ) : (
          <SpatialTransport
            anim={cam.anim}
            editable={canManage}
            trackSwitch={trackSwitch}
            onAttach={cam.attach}
            drawerOpen={state.drawer === 'curves'}
            onDrawer={() => update({ drawer: state.drawer === 'curves' ? null : 'curves' })}
          />
        )
      }
      drawer={state.drawer === 'curves' ? <CurvesDrawer anim={cam.anim} editable={canManage} /> : undefined}
    >
      <Model3DThreePane
        status={data.media.status}
        loadError={model3d.loadError}
        containerRef={model3d.containerRef}
        overlay={overlay}
        aspect={data.splatPresentation?.camera?.aspect}
        pip={
          model3d.layoutMode ? (
            <PipFrame
              label="Caméra layout"
              aspect={data.splatPresentation?.camera?.aspect ?? DEFAULT_REVIEW_ASPECT}
              onRect={model3d.setPipRect}
            />
          ) : undefined
        }
        canReprocess={role !== 'CLIENT'}
        reprocessing={reprocessing}
        processingError={data.processingError}
        onReprocess={onReprocess}
      />
      {canRecompose && usd && (
        <UsdRecomposeDialog
          open={recomposeOpen}
          onOpenChange={setRecomposeOpen}
          mediaId={data.media.id}
          usd={usd}
        />
      )}
    </ReviewChrome>
  );
}

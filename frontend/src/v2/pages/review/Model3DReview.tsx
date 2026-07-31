import { useState, type ReactNode } from 'react';
import { Grid3x3, Maximize, Move3d, Rotate3d } from 'lucide-react';
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
import Model3DAnimationsBar from './Model3DAnimationsBar';
import Model3DTransformBar from './Model3DTransformBar';
import LightingBar from './LightingBar';
import InspectBar from './InspectBar';
import Model3DVariantsBar from './Model3DVariantsBar';
import ModelInfoPanel from './ModelInfoPanel';
import BookmarksBar from './BookmarksBar';
import TurntableBar from './TurntableBar';
import SectionBar from './SectionBar';
import Model3DCompareBar from './Model3DCompareBar';
import CameraBar from './camera/CameraBar';
import AnimPanel from './camera/timeline/AnimPanel';
import ViewerHud, { HudGroup, HudIconButton } from './hud/ViewerHud';
import PipFrame from './viewer/PipFrame';
import UsdRecomposeDialog from './UsdRecomposeDialog';
import { DEFAULT_REVIEW_ASPECT } from './frameRect';

/**
 * Bloc modèle 3D de la review (Phase 17) : orchestre le viewer Three (Model3DThreePane) et le
 * **HUD flottant unifié** (comme le splat) — barre caméra commune, timeline keyframe, animations
 * du GLB, et transformation par gizmo TRS avant publication. Remplace l'ancien couple
 * `Model3DToolbar` + `Model3DCameraBar` (barres sous le viewer). L'orchestrateur reste fin :
 * l'état caméra/présentation vit dans `useModel3DCamera`.
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
  onFullscreen,
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
  /** Bascule le plein écran de tout le bloc review (viewer + commentaires). */
  onFullscreen: () => void;
  overlay: ReactNode;
  /** Modèle chargé et affichable (HUD monté seulement alors). */
  ready: boolean;
}) {
  const cam = useModel3DCamera(model3d, data, canManage, onSaved, ann);
  // Éclairage HDRI (Phase 29) : défaut rejoué pour tous, tweak spectateur temporaire.
  const lighting = useModel3DLighting(model3d, data, canManage, onSaved);
  // Inspection (Phase 39) : modes d'affichage + fiche technique — local à la session.
  const inspect = useModel3DInspect(model3d);
  // Variantes de matériaux + caméras embarquées (40.C) — local à la session.
  const variants = useModel3DVariants(model3d);
  // Bookmarks caméra partagés (39.D) : vues nommées rejouées pour tous, raccourcis 1-9.
  const bookmarks = useModel3DBookmarks(model3d, data, canManage, onSaved);
  // Turntable + plan de coupe (39.D) : prévisualisations d'inspection session-local.
  const turntable = useTurntable(model3d);
  const section = useSectionPlane(model3d);
  // Comparaison A/B des modèles 3D d'une version (39.E) : caméra liée (même scène).
  const compare = useModel3DCompare(model3d, data.media);
  const [infoOpen, setInfoOpen] = useState(false);
  // Recomposition USD (45.F) : réservée aux gestionnaires, refusée après publication (verrou P11).
  const [recomposeOpen, setRecomposeOpen] = useState(false);
  const usd = data.modelSource?.usd ?? null;
  const canRecompose = canManage && !data.media.published && !!usd;
  // Grille de sol (repère d'orientation de la scène) — togglable, préférence locale.
  const grid = useSceneGrid(model3d);
  // Caméra-objet dans la scène (mode layout) : mesh + trajectoire + gizmo d'édition des clés.
  const rig = useCameraSceneRig({
    getSceneHandle: model3d.getSceneHandle,
    subscribeFrame: model3d.subscribeFrame,
    ready,
    active: model3d.layoutMode,
    editable: canManage,
    anim: cam.anim,
  });
  return (
    <>
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
        hud={
          ready ? (
            <ViewerHud
              topLeft={showEditTools ? <Model3DTransformBar m={model3d} /> : undefined}
              topRight={
                <>
                  <InspectBar
                    inspect={inspect}
                    infoOpen={infoOpen}
                    onToggleInfo={() => setInfoOpen((v) => !v)}
                  />
                  {infoOpen && (
                    <ModelInfoPanel
                      stats={inspect.stats}
                      extensions={inspect.extensions}
                      source={data.modelSource}
                      onRecompose={canRecompose ? () => setRecomposeOpen(true) : undefined}
                      onClose={() => setInfoOpen(false)}
                    />
                  )}
                  <Model3DVariantsBar v={variants} />
                  {model3d.layoutMode && canManage && (
                    <HudGroup>
                      <span className="text-muted-foreground">Caméra-objet</span>
                      <HudIconButton
                        icon={Move3d}
                        hint="Déplacer la caméra-objet (pose)"
                        active={rig.mode === 'translate'}
                        onClick={() => rig.setMode('translate')}
                      />
                      <HudIconButton
                        icon={Rotate3d}
                        hint="Orienter la caméra-objet (regard)"
                        active={rig.mode === 'rotate'}
                        onClick={() => rig.setMode('rotate')}
                      />
                    </HudGroup>
                  )}
                  <TurntableBar tt={turntable} />
                  <SectionBar sec={section} />
                  <HudGroup>
                    <HudIconButton
                      icon={Grid3x3}
                      hint="Grille de sol (repère d'orientation de la scène)"
                      active={grid.visible}
                      onClick={grid.toggle}
                    />
                    <HudIconButton icon={Maximize} hint="Plein écran" onClick={onFullscreen} />
                  </HudGroup>
                </>
              }
              bottomLeft={
                <>
                  <Model3DAnimationsBar m={model3d} />
                  {compare.enabled && !showEditTools && <Model3DCompareBar compare={compare} />}
                  <BookmarksBar bm={bookmarks} />
                  <LightingBar lighting={lighting} colorView={data.projectColor?.view} />
                  <CameraBar
                    fov={model3d.fov}
                    onFov={model3d.setFov}
                    roll={model3d.roll}
                    onRoll={model3d.setRoll}
                    onFrame={model3d.frameView}
                    onHome={model3d.homeView}
                    kf={cam.anim}
                    layout={{
                      active: model3d.layoutMode,
                      onToggle: () => model3d.setLayoutMode(!model3d.layoutMode),
                    }}
                  />
                  <AnimPanel
                    anim={cam.anim}
                    onOrbitPreset={cam.applyOrbitPreset}
                    onSave={cam.save}
                    onClear={cam.clear}
                    busy={cam.busy}
                    onAttach={cam.attach}
                    onImport={cam.importGltf}
                    editable={canManage}
                  />
                </>
              }
            />
          ) : undefined
        }
      />
      {canRecompose && usd && (
        <UsdRecomposeDialog
          open={recomposeOpen}
          onOpenChange={setRecomposeOpen}
          mediaId={data.media.id}
          usd={usd}
        />
      )}
    </>
  );
}

import type { ReactNode } from 'react';
import type { MediaResp, SplatEditsPatch } from './reviewTypes';
import type { Annotations } from './useAnnotations';
import type { Model3DThreeState } from './three/useModel3DThree';
import type { Role } from '../../types/api';
import { useModel3DCamera } from './three/useModel3DCamera';
import { useCameraSceneRig } from './camera/sceneRig/useCameraSceneRig';
import Model3DThreePane from './Model3DThreePane';
import Model3DAnimationsBar from './Model3DAnimationsBar';
import Model3DTransformBar from './Model3DTransformBar';
import CameraBar from './camera/CameraBar';
import AnimPanel from './camera/timeline/AnimPanel';
import ViewerHud from './hud/ViewerHud';

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
  /** Modèle chargé et affichable (HUD monté seulement alors). */
  ready: boolean;
}) {
  const cam = useModel3DCamera(model3d, data, canManage, onSaved, ann);
  // Caméra-objet dans la scène (mode layout) : mesh + trajectoire + gizmo d'édition des clés.
  useCameraSceneRig({
    getSceneHandle: model3d.getSceneHandle,
    subscribeFrame: model3d.subscribeFrame,
    ready,
    active: model3d.layoutMode,
    editable: canManage,
    anim: cam.anim,
  });
  return (
    <Model3DThreePane
      status={data.media.status}
      loadError={model3d.loadError}
      containerRef={model3d.containerRef}
      overlay={overlay}
      aspect={data.splatPresentation?.camera?.aspect}
      layoutMode={model3d.layoutMode}
      canReprocess={role !== 'CLIENT'}
      reprocessing={reprocessing}
      onReprocess={onReprocess}
      hud={
        ready ? (
          <ViewerHud
            topLeft={showEditTools ? <Model3DTransformBar m={model3d} /> : undefined}
            bottomLeft={
              <>
                <Model3DAnimationsBar m={model3d} />
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
  );
}

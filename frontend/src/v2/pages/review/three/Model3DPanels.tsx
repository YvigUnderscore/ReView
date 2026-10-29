// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Download, Upload } from 'lucide-react';
import { Button } from '@/v2/components/ui/button';
import type { PanelId } from '../chrome/panels';
import CameraPanel from '../panels/CameraPanel';
import ExportPanel, { CaptureViewButton } from '../panels/ExportPanel';
import LightingPanel from '../panels/LightingPanel';
import Model3DInfo from './Model3DInfo';
import Model3DPerfGroup from './Model3DPerfGroup';
import ScenePanel from '../panels/ScenePanel';
import ScenegraphPanel from '../panels/ScenegraphPanel';
import UsdRecomposeGroup from '../panels/UsdRecomposeGroup';
import { focalToFov, fovToFocal } from '../camera/focal';
import { shouldKeyLens } from '../camera/shotCamera';
import { evalChannel } from '../camera/channels/hermite';
import { confirmClearPresentation } from '../camera/confirmReplaceAnim';
import { mediaReviewAspect, reviewAspectLabel } from '../reviewAspect';
import type { MediaResp } from '../reviewTypes';
import { downloadAnimGltf } from './exportCameraGltf';
import type { Model3DBookmarksState } from './useModel3DBookmarks';
import type { Model3DInspectState } from './useModel3DInspect';
import type { Model3DLightingState } from './useModel3DLighting';
import type { Model3DThreeState } from './useModel3DThree';
import type { ModelMeasureState } from './useModelMeasure';
import type { SectionPlaneState } from './useSectionPlane';
import type { TurntableState } from './useTurntable';
import type { UsdSceneState } from './useUsdScene';
import type { CameraAnimState } from '../camera/useCameraAnim';
import { useT } from '@/v2/i18n';

const RAD = Math.PI / 180;

/**
 * Content of the inspector dock for the 3D viewer. Gathers what floated in `InspectBar`,
 * `Model3DVariantsBar`, `LightingBar`, `BookmarksBar`, `TurntableBar`, `SectionBar`,
 * `ModelInfoPanel` and `CameraBar`. Five tabs since Phase 50: "Display" moved to a popover in the
 * top-left corner of the viewer (`Model3DRenderMenu`), where one tries a render mode while looking
 * at the model. The Info tab lives in `Model3DInfo`: it is the only one whose content does not fit
 * in a few lines here.
 */
export default function Model3DPanels({
  panel,
  data,
  m,
  anim,
  lighting,
  inspect,
  staging,
  bookmarks,
  turntable,
  section,
  grid,
  measure,
  scene,
  onSaveOverride,
  savingOverride,
  canRecompose,
  onRecompose,
  onImportAnim,
  onOrbit,
  onClearPresentation,
}: {
  panel: PanelId | null;
  data: MediaResp;
  m: Model3DThreeState;
  anim: CameraAnimState;
  lighting: Model3DLightingState;
  inspect: Model3DInspectState;
  /**
   * Staging: the Camera panel toggle IS its entry since Phase 50: the mode switch no longer carries
   * a "Staging" segment, which only turned on the layout this toggle already turned on. It therefore
   * arms the whole mode (PiP view, camera-object, camera tools on the rail, "Publish" button in the
   * options bar).
   */
  staging: { active: boolean; toggle: () => void };
  bookmarks: Model3DBookmarksState;
  turntable: TurntableState;
  section: SectionPlaneState;
  grid: { visible: boolean; toggle: () => void };
  /** Real dimensions and measuring tool (39.G), shown in the Info tab. */
  measure: ModelMeasureState;
  /** USD scenegraph and override (46.C), absent if the media is not a USD scene. */
  scene?: UsdSceneState;
  /** Saves the base override: absent after publication or without rights (46.D). */
  onSaveOverride?: () => void;
  savingOverride?: boolean;
  /** USD recomposition allowed (manager and USD source): its group lives in the Scene panel. */
  canRecompose?: boolean;
  /**
   * Shortcut from the technical sheet to this group. It used to open a modal covering the
   * viewer; it no longer opens anything: it leads to the Scene panel, where the recomposition is set
   * without leaving the scene in sight.
   */
  onRecompose?: () => void;
  onImportAnim?: (file: File) => void;
  /** Orbit preset (manager). */
  onOrbit?: () => void;
  /** Clears the persisted presentation (manager, confirmed here). */
  onClearPresentation?: () => void;
}) {
  const t = useT();
  if (panel === 'camera') {
    const saved = data.splatPresentation?.bookmarks ?? [];
    // Focal length and tilt reflect the value sampled at the current time when the channel is animated.
    // Modifying them sets an `fov`/`roll` key at the playhead as soon as we are off-camera; otherwise the
    // panel showed the value of the plane and wrote onto the free camera (cf. `shouldKeyLens`).
    const fovNow = anim.anim.channels.fov ? evalChannel(anim.anim.channels.fov, anim.timeMs, m.fov) : m.fov;
    const rollNow = anim.anim.channels.roll
      ? evalChannel(anim.anim.channels.roll, anim.timeMs, m.roll)
      : m.roll;
    // Review frame: this panel only STATES it; its ratio comes from the pipeline settings,
    // except for a media whose presentation has already frozen the aspect (`reviewAspect`).
    const frame = mediaReviewAspect(data);
    return (
      <CameraPanel
        focalMm={Math.round(fovToFocal(fovNow))}
        onFocalMm={(mm) => {
          const fov = focalToFov(Math.min(Math.max(mm, 7), 400));
          m.setFov(fov);
          if (shouldKeyLens(m.layoutMode, anim.autoKey)) anim.addKey('fov', anim.timeMs, fov);
        }}
        tiltDeg={Math.round(rollNow / RAD)}
        onTiltDeg={(deg) => {
          m.setRoll(deg * RAD);
          if (shouldKeyLens(m.layoutMode, anim.autoKey)) anim.addKey('roll', anim.timeMs, deg * RAD);
        }}
        layout={{
          active: staging.active,
          onToggle: staging.toggle,
          // Named by the mode it arms, not by the window it opens.
          label: t('mode.stage'),
          hint: t('mode.stage.hint'),
          onOrbit,
          onClear: onClearPresentation ? () => confirmClearPresentation(onClearPresentation) : undefined,
        }}
        aspect={{ label: reviewAspectLabel(frame.value), frozen: frame.frozen }}
        onFrame={m.frameView}
        onHome={m.homeView}
        bookmarks={{
          items: saved.map((b, i) => ({ id: String(i), label: b.label ?? t('camera.viewN', { n: i + 1 }) })),
          activeId: null,
          onGo: (id) => bookmarks.recall(Number(id)),
          onSave: bookmarks.add && (() => void bookmarks.add?.()),
          onRemove: bookmarks.remove && ((id) => void bookmarks.remove?.(Number(id))),
          busy: bookmarks.busy,
          full: bookmarks.full,
        }}
      />
    );
  }

  if (panel === 'light')
    return (
      <LightingPanel
        lighting={lighting}
        colorDisplay={data.projectColor?.display}
        colorView={data.projectColor?.view}
      />
    );

  if (panel === 'scene')
    return (
      <>
        <ScenePanel
          grid={{ visible: grid.visible, onToggle: grid.toggle }}
          section={{
            active: section.active,
            onActive: section.toggle,
            axis: section.axis,
            onAxis: section.setAxis,
            position: section.position,
            onPosition: section.setPosition,
            flipped: section.flip,
            onFlip: section.toggleFlip,
          }}
          turntable={{
            active: turntable.active,
            onActive: turntable.toggle,
            axis: turntable.axis,
            onAxis: turntable.setAxis,
            speed: turntable.speed,
            onSpeed: turntable.setSpeed,
          }}
          // LOD, culling and reveal effect are specific to the splat: the model has none.
          // Its render counters are in the group that follows.
          perf={{}}
          // USD scenegraph (46.C): the real tree of the scene, above the scene landmarks.
          scenegraph={
            scene && scene.tree.length > 0 ? (
              <ScenegraphPanel
                scene={scene}
                usd={data.modelSource?.usd ?? null}
                baked={data.modelSource?.blender?.variantsBaked ?? null}
                onRevert={scene.revert}
                onSave={onSaveOverride}
                saving={savingOverride}
              />
            ) : undefined
          }
          // Recomposition in contact with the tree it changes (lot 13): the modal that
          // covered the viewer became this group, which scrolls with the panel.
          recompose={
            canRecompose && data.modelSource?.usd ? (
              <UsdRecomposeGroup mediaId={data.media.id} usd={data.modelSource.usd} />
            ) : undefined
          }
        />
        <Model3DPerfGroup m={m} textures={inspect.stats?.textures ?? null} />
      </>
    );

  if (panel === 'info')
    return <Model3DInfo data={data} inspect={inspect} measure={measure} m={m} onRecompose={onRecompose} />;

  if (panel === 'export')
    return (
      <ExportPanel
        originalUrl={data.url}
        originalName={data.media.originalName}
        staging={
          <>
            <Button
              size="sm"
              variant="outline"
              disabled={!anim.hasAnimation}
              onClick={() => void downloadAnimGltf(anim.anim)}
            >
              <Download size={13} />
              {t('review.cameraAnimGltf')}
            </Button>
            {onImportAnim && (
              <label
                title={t('review.camera.import')}
                className="flex min-h-8 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-border px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
              >
                <Upload size={13} />
                {t('review.importAnimation')}
                <input
                  type="file"
                  accept=".gltf,.glb,.json,model/gltf+json,model/gltf-binary,application/json"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onImportAnim(f);
                    e.target.value = '';
                  }}
                />
              </label>
            )}
            <CaptureViewButton capture={m.captureView} originalName={data.media.originalName} />
          </>
        }
      />
    );

  return null;
}

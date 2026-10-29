// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '../../components/ui/context-menu';
import PrimMenuItems from './panels/PrimMenuItems';
import { useSaveSceneOverride } from './three/useSaveSceneOverride';
import { useCommentSceneEscape } from './three/useCommentSceneEscape';
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
import { useModel3DViewState } from './three/useModel3DViewState';
import { useModelMeasure } from './three/useModelMeasure';
import { usePoiPlacement } from './poi/usePoiPlacement';
import Model3DNotice from './three/Model3DNotice';
import SpatialCompareHeader from './three/SpatialCompareHeader';
import { useCameraSceneRig } from './camera/sceneRig/useCameraSceneRig';
import { useCameraShortcuts } from './camera/useCameraShortcuts';
import { useModel3DCommands } from './three/useModel3DCommands';
import { useSceneGrid } from './viewer/useSceneGrid';
import Model3DThreePane from './Model3DThreePane';
import Model3DCompareBar from './Model3DCompareBar';
import Model3DPanels from './three/Model3DPanels';
import { useModel3DChrome } from './three/useModel3DChrome';
import Model3DOptions from './options/Model3DOptions';
import type { SplatPaintState } from './splat/paint/useSplatPaint';
import ReviewChrome from './chrome/ReviewChrome';
import { DEFAULT_MODE } from './chrome/modes';
import { DEFAULT_TOOL } from './chrome/tools';
import { useModel3DModes } from './three/useModel3DModes';
import Model3DRenderMenu from './three/Model3DRenderMenu';
import SpatialTransport from './transport/SpatialTransport';
import ClipTransport from './transport/ClipTransport';
import CurvesDrawer from './transport/CurvesDrawer';
import TrackSwitch, { type TrackId } from './transport/TrackSwitch';
import PipFrame from './viewer/PipFrame';
import { useUsdScene } from './three/useUsdScene';
import { useSceneEditShortcuts } from './three/useSceneEditShortcuts';
import { normalizeOverride } from './three/sceneOverride';
import { usePrimPointer } from './three/usePrimPointer';
import { mediaReviewAspect } from './reviewAspect';
import { useT } from '../../i18n';

/**
 * 3D model block of the review, mounted in the unified chrome — the same five slots as the
 * splat, plus a Lighting panel (a model is lit, a cloud carries its own light). The eleven
 * floating bars of the old HUD are spread across the rail (gizmos, pin, camera-object), the
 * options bar, the five dock panels, the render popover in the viewer's top-left corner and
 * the two-track transport.
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
  paint,
  overlay,
  exit,
}: {
  data: MediaResp;
  model3d: Model3DThreeState;
  ann: Annotations;
  canManage: boolean;
  /** Transform editing (pre-publish + rights) — TRS gizmo. */
  showEditTools: boolean;
  role?: Role;
  reprocessing: boolean;
  onReprocess: () => void;
  onSaved: (patch: SplatEditsPatch) => void;
  /**
   * Surface brush — instantiated by the page, as for the splat: the strokes go with the
   * comment, and it is the same hook on both sides (batch 13).
   */
  paint: SplatPaintState;
  overlay: ReactNode;
  /** Exit of an annotated comment playback — moved down into the viewer, like the overlay. */
  exit: ReactNode;
}) {
  const t = useT();
  // Three scene actually built (model loaded, runtime set up). Not to be confused with
  // "the media is displayable": hooks that read the scene imperatively have nothing to read
  // until the GLB is loaded, and their effect would not be replayed afterwards.
  const ready = model3d.ready;
  // Delivery frame: ratio from the pipeline settings, unless the aspect is already frozen (`reviewAspect`).
  const frameAspect = mediaReviewAspect(data).value;
  const cam = useModel3DCamera(model3d, data, canManage, onSaved, ann);
  // HDRI lighting: default replayed for everyone, temporary viewer tweak.
  const lighting = useModel3DLighting(model3d, data, canManage, onSaved);
  // Inspection: display modes + spec sheet — local to the session.
  const inspect = useModel3DInspect(model3d);
  // Material variants + embedded cameras — local to the session.
  const variants = useModel3DVariants(model3d);
  // Shared camera bookmarks: named views replayed for everyone.
  const bookmarks = useModel3DBookmarks(model3d, data, canManage, onSaved);
  // Turntable + section plane: session-local inspection previews.
  const turntable = useTurntable(model3d);
  const section = useSectionPlane(model3d);
  // 3D model A/B comparison: siblings of the version **and** models from other versions
  // checked in `CompareSelect` — all loaded into the same scene (linked camera).
  const compare = useModel3DCompare(model3d, data.media);
  // Point-to-point measurement and real dimensions (39.G): the unit comes from the USD scene.
  const measure = useModelMeasure(model3d, data.modelSource?.usd?.metersPerUnit ?? 1);
  // Display mode + section plane + HDRI attached to the comment's camera view.
  useModel3DViewState({ model3d, inspect, section, lighting });

  // USD scenegraph + "ReView override" (46.C): the media's base override is replayed for
  // everyone, the viewer's local exploration stays in their session.
  // Memoized: without it the override would be a new object on every render and the scene
  // would be reapplied in a loop.
  const commentOverride = useMemo(
    () => normalizeOverride(ann.viewedSceneOverride),
    [ann.viewedSceneOverride],
  );
  const scene = useUsdScene(data, model3d.getSceneHandle, ready, commentOverride, ann.setSceneOverride);
  // Viewer pointer: a still left click = selection, a SHORT right click = menu of the targeted
  // prim (46.M) — when held, the same button steals. `resolvePick` (not `resolvePrim`): the
  // click designates the enclosing component, Alt+click the exact leaf.
  const primMenu = usePrimPointer(model3d, ready, scene.select, scene.resolvePick);
  // `F` frames the selected prim (46.I) — the viewer keeps its global framing with no selection.
  const { setFrameTarget } = model3d;
  useEffect(() => {
    setFrameTarget(scene.selectedObjects);
    return () => setFrameTarget(null);
  }, [setFrameTarget, scene.selectedObjects]);
  // Sending a comment carries the proposal (the composer is cleared): the local exploration
  // restarts from zero — like the placed points. Without this, the scenegraph footer would
  // promise a delta that the next comment no longer carries. The freshly created comment,
  // once selected, replays exactly what was just proposed.
  //
  // It is the **transition** proposal → empty that signs the send. Reacting to the
  // "no proposal" state alone was enough to cancel the very first gizmo delta: it arrived one
  // render before the proposal reached the composer, and the effect saw "nothing attached +
  // dirty exploration" — the object snapped back to its origin on mouse release.
  const { revert, dirty: sceneDirty } = scene;
  const hadProposal = useRef(ann.sceneOverride != null);
  useEffect(() => {
    const has = ann.sceneOverride != null;
    if (hadProposal.current && !has && sceneDirty) revert();
    hadProposal.current = has;
  }, [ann.sceneOverride, sceneDirty, revert]);
  // Escape releases the scene proposed by the selected comment (46.T). Read twice —
  // here and by the viewer banner — but without an intermediate name: this file's budget
  // is reached, and batch 13 moves the comment playback exit down here.
  const { setViewedSceneOverride } = ann;
  const releaseCommentScene = useCallback(() => setViewedSceneOverride(null), [setViewedSceneOverride]);
  useCommentSceneEscape(ann.viewedSceneOverride != null, releaseCommentScene);
  // Recomposition and USD override: reserved for managers, and allowed AFTER publication
  // (Phase 50) — the override layer is replayed on top of the original file, which is never
  // rewritten. The lock only guards the mount and the `transform`.
  // Recomposition is no longer a modal (batch 13): its group lives in the Scene panel.
  const saveOverride = useSaveSceneOverride({
    mediaId: data.media.id,
    allowed: canManage,
    merged: () => scene.merged,
    onSaved: scene.revert,
  });
  const usd = data.modelSource?.usd ?? null;
  const canRecompose = canManage && !!usd;
  const grid = useSceneGrid(model3d);
  const [track, setTrack] = useState<TrackId>('camera');

  // Camera-object in the scene (layout mode): mesh + trajectory + keyframe editing gizmo.
  const rig = useCameraSceneRig({
    getSceneHandle: model3d.getSceneHandle,
    subscribeFrame: model3d.subscribeFrame,
    ready,
    editable: canManage,
    anim: cam.anim,
    layout: model3d.layout,
  });

  // 3D model toggle and rail (Phase 50, batch 6): "Staging" is no longer listed there — the
  // switch in the Camera panel arms it — and "Clean up" only appears if the server grants
  // write access to the transform.
  // A USD scene gives the gizmos a second target — the per-prim scene override (46.N), which
  // does not go through the version transform and therefore lacks its rights. `isFlying` is
  // the chrome's flight guard: right button held, no letter arms a tool.
  const { state, update, modes, tools, activeTool, brushLayer } = useModel3DModes(
    { canEditTransform: showEditTools, hasScenegraph: scene.tree.length > 0 },
    model3d,
    { ann, paint },
  );
  // Camera transport shortcuts (camera track only — the clips track has its own transport).
  useCameraShortcuts({
    anim: cam.anim,
    active: track === 'camera',
    editable: canManage,
    undoActive: state.mode === 'stage',
    fps: data.fps ?? 24,
  });
  const { history, dirty } = useModel3DChrome({ state, m: model3d, paint, cameraRig: rig, usdScene: scene });
  // USD scene rearrangement from the keyboard: Delete hides the selection (non-destructive
  // override), Ctrl+Z/Y restore it — on the viewer's history, not a separate stack.
  // The curve editor keeps Delete when open: its keys are what gets deleted there.
  useSceneEditShortcuts({
    scene,
    history,
    deleteEnabled: state.drawer !== 'curves',
    isFlying: model3d.isFlying,
  });

  // Ctrl+K palette (B3): frame/play/key/orbit commands, extracted into their hook.
  useModel3DCommands(cam, model3d, canManage, !!data.splatPresentation, measure);

  // Points of interest: ARMING THE TOOL IS BEING IN PLACEMENT — the next click in the view
  // places a point, with no intermediate button. Same hook and same gesture as on the splat.
  const placingPoi = activeTool.id === 'pin';
  usePoiPlacement({
    viewer: model3d,
    armed: placingPoi,
    ann,
    onExit: () => update({ tool: DEFAULT_TOOL }),
  });
  const trackSwitch = <TrackSwitch track={track} onTrack={setTrack} hasClips={!!model3d.animations.length} />;

  return (
    <ReviewChrome
      kind="MODEL_3D"
      state={state}
      onState={update}
      role={role ?? 'ARTIST'}
      modes={modes}
      tools={tools}
      headerRight={
        <SpatialCompareHeader
          versionId={data.media.versionId}
          mediaId={data.media.id}
          kind="MODEL_3D"
          versions={compare.versions}
        >
          {compare.enabled && !showEditTools && <Model3DCompareBar compare={compare} />}
        </SpatialCompareHeader>
      }
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
          poi={ann.poi}
          paint={paint}
          presentation={canManage ? { busy: cam.busy, onSave: () => void cam.save?.() } : undefined}
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
          staging={{
            active: state.mode === 'stage',
            toggle: () => update({ mode: state.mode === 'stage' ? DEFAULT_MODE : 'stage' }),
          }}
          bookmarks={bookmarks}
          turntable={turntable}
          section={section}
          grid={grid}
          measure={measure}
          scene={scene}
          onSaveOverride={saveOverride.run}
          savingOverride={saveOverride.busy}
          canRecompose={canRecompose}
          onRecompose={canRecompose ? () => update({ panel: 'scene' }) : undefined}
          onImportAnim={canManage ? cam.importGltf : undefined}
          onOrbit={canManage ? () => cam.applyOrbitPreset() : undefined}
          onClearPresentation={cam.clear && data.splatPresentation ? () => void cam.clear?.() : undefined}
        />
      }
      transport={
        track === 'clip' ? (
          <ClipTransport m={model3d} trackSwitch={trackSwitch} />
        ) : (
          <SpatialTransport
            anim={cam.anim}
            editable={canManage}
            fps={data.fps ?? 24}
            trackSwitch={trackSwitch}
            attach={cam.attach}
            drawerOpen={state.drawer === 'curves'}
            onDrawer={() => update({ drawer: state.drawer === 'curves' ? null : 'curves' })}
          />
        )
      }
      drawer={
        state.drawer === 'curves' ? (
          <CurvesDrawer
            anim={cam.anim}
            editable={canManage}
            fps={data.fps ?? 24}
            height={state.drawerH}
            onHeight={(h) => update({ drawerH: h })}
            onOrbitPreset={canManage ? () => cam.applyOrbitPreset() : undefined}
          />
        ) : undefined
      }
    >
      {/* Short right click on an object → actions for the targeted prim (46.M). `useSpatialContextMenu`
          stops the canvas event (flight, click in empty space): the menu never opens on empty
          space, and never in the middle of a flight. */}
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className="contents">
            <Model3DThreePane
              status={data.media.status}
              loadError={model3d.loadError}
              containerRef={model3d.containerRef}
              overlay={overlay}
              editorOverlay={brushLayer}
              exit={exit}
              recording={canManage && cam.anim.autoKey}
              settings={<Model3DRenderMenu inspect={inspect} variants={variants} />}
              aspect={frameAspect}
              pip={
                model3d.layoutMode ? (
                  <PipFrame
                    label={t('review.layoutCamera')}
                    aspect={frameAspect}
                    onRect={model3d.setPipRect}
                  />
                ) : undefined
              }
              canReprocess={role !== 'CLIENT'}
              reprocessing={reprocessing}
              processingError={data.processingError}
              onReprocess={onReprocess}
              notice={
                <Model3DNotice
                  placingPoi={placingPoi}
                  poiCount={ann.poi.points.length}
                  commentScene={ann.viewedSceneOverride != null}
                  onReleaseScene={releaseCommentScene}
                />
              }
            />
          </div>
        </ContextMenuTrigger>
        {primMenu && (
          <ContextMenuContent>
            <PrimMenuItems
              scene={scene}
              usd={usd}
              baked={data.modelSource?.blender?.variantsBaked ?? null}
              path={primMenu}
              onFrame={model3d.frameView}
            />
          </ContextMenuContent>
        )}
      </ContextMenu>
    </ReviewChrome>
  );
}

// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, type ReactNode } from 'react';
import type { Role } from '@/v2/types/api';
import type { MediaResp, SplatEditsPatch } from '../reviewTypes';
import type { Annotations } from '../useAnnotations';
import type { SplatViewer } from './useSplat';
import { useSceneGrid } from '../viewer/useSceneGrid';
import { useCameraSceneRig } from '../camera/sceneRig/useCameraSceneRig';
import PipFrame from '../viewer/PipFrame';
import { mediaReviewAspect } from '../reviewAspect';
import CompareControl from './compare/CompareControl';
import { useSplatCompare } from './compare/useSplatCompare';
import SpatialCompareHeader from '../three/SpatialCompareHeader';
import SurfaceBrushLayer from './paint/SurfaceBrushLayer';
import type { SplatPaintState } from './paint/useSplatPaint';
import { usePresentation } from './presentation/usePresentation';
import { useSplatEditor } from './editor/useSplatEditor';
import SelectionOverlay from './editor/selection/SelectionOverlay';
import ReviewChrome from '../chrome/ReviewChrome';
import { useSpatialAnnotate } from '../chrome/useSpatialAnnotate';
import { DEFAULT_MODE } from '../chrome/modes';
import { DEFAULT_TOOL } from '../chrome/tools';
import { usePoiPlacement } from '../poi/usePoiPlacement';
import SplatOptions from '../options/SplatOptions';
import SpatialTransport from '../transport/SpatialTransport';
import CurvesDrawer from '../transport/CurvesDrawer';
import SplatPanels from './SplatPanels';
import { useSplatChrome } from './useSplatChrome';
import { useSavedSplatEdits } from './useSavedSplatEdits';
import { useSplatInput } from './scene/useSplatInput';
import { useSplatView } from './useSplatView';
import SplatPane from './SplatPane';
import SplatViewerMenus from './SplatViewerMenus';
import SplatContextMenu from './SplatContextMenu';
import { hasSplatEditProposal } from './splatEditPart';
import Model3DNotice from '../three/Model3DNotice';
import { useCommentSceneEscape } from '../three/useCommentSceneEscape';
import { useT } from '@/v2/i18n';

/**
 * Splat block of the review, mounted in the unified chrome: tool rail on the left, options of the armed
 * tool under the header, inspector dock on the right, camera-animation transport at the bottom. Nothing
 * floats above the cloud any more: only the overlays anchored to the view remain (3D brush strokes,
 * selection trace, camera layout PiP).
 *
 * The business state has not moved: `useSplatEditor` carries the editing, `usePresentation` the staging,
 * `useSplatCompare` the A/B. The rail merely arms the tool; `useSplatChrome` makes the hooks follow.
 *
 * This component no longer computes anything: `useSplatView` holds the view state (chrome, culling, selection
 * trace tool, unsaved presentation) and `scene/useSplatInput` the pointer/keyboard wiring. Here only the
 * composition of the chrome and of the overlays remains.
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
  exit,
  ann,
}: {
  data: MediaResp;
  splat: SplatViewer;
  /** Editor mounted (manager + viewer ready): published or not, editing remains on offer. */
  showEdit: boolean;
  /** Manager: can persist the presentation (allowed even when published: staging). */
  canPresent: boolean;
  /** 3D surface brush: instantiated by the page (the strokes leave with the comment). */
  paint: SplatPaintState;
  onSaved: (patch: SplatEditsPatch) => void;
  /** Role of the viewer: the client does not see the mode switch. */
  role?: Role;
  overlay: ReactNode;
  /** Exit of the playback of an annotated comment: moved down into the viewer, like the overlay. */
  exit: ReactNode;
  /** Annotations (layout mode: attach / replay a camera animation in the comments). */
  ann: Annotations;
}) {
  const t = useT();
  const saved = data.splatEdits;
  /**
   * Writing the cloud's edits FOR EVERYONE stops at publication: the same line as for the 3D model, and
   * the one the server now applies (`lib/publishLock`). In a studio that does not use drafts, the media is
   * born published: no "Save" button therefore ever appears above the viewer, without having had to invent
   * a second rule. Editing, on the other hand, remains on offer: the edit goes into a comment.
   */
  const canSaveForAll = showEdit && !data.media.published;
  /** Edit proposal carried by the selected comment: replayed, never written. */
  const viewedEdit = ann.viewedSplatEdit;
  const editor = useSplatEditor(
    splat,
    data.media.id,
    saved,
    data.splatMaskUrl,
    data.splatSubsetUrl,
    onSaved,
    showEdit,
    // Reading a comment's proposal suspends the editor: a single cloud, and it is the comment that speaks.
    // The local edit comes back intact on exit.
    viewedEdit != null,
  );
  const { ready, getSceneHandle } = splat;
  // Delivery frame: ratio from the pipeline settings, unless the aspect is already frozen (`reviewAspect`).
  const frameAspect = mediaReviewAspect(data).value;

  const grid = useSceneGrid(splat);
  const pres = usePresentation(splat, data, onSaved);
  const compare = useSplatCompare(splat, data.media);
  // View state: chrome (mode / tool / panel), culling, selection trace armed, gap between the current
  // animation and the persisted presentation.
  const { state, update, modes, culling, activeTool, railExtra, selectTool, animDirty } = useSplatView({
    splat,
    data,
    pres,
    editorTool: editor.tool,
    showEdit,
  });
  // The composer's "Annotate" button ↔ the rail's "Annotate" mode: without this bridge, clicking "Annotate"
  // on a cloud only armed the 2D pencil and the scene's tools remained invisible.
  useSpatialAnnotate({ state, update, ann });

  // Camera-object in the scene (layout mode): mesh + trajectory + key gizmo.
  const cameraRig = useCameraSceneRig({
    getSceneHandle: splat.getSceneHandle,
    subscribeFrame: splat.subscribeFrame,
    ready: splat.ready,
    editable: canPresent,
    anim: pres.anim,
    layout: pres.layout,
  });

  useSplatChrome({
    state,
    editor,
    paint,
    focusPick: pres.rig.focusPick,
    onToggleFocusPick: pres.rig.toggleFocusPick,
    cameraRig,
  });

  // Replay of the edits in reading mode (transform, flip, volumes, mask, subsets): those of the media outside
  // the editor, and those of a comment as soon as it proposes some, manager included.
  useSavedSplatEdits(splat, data, showEdit, viewedEdit);

  // Pointer/keyboard wiring: camera transport, F/H framing, Ctrl+K palette, and the two camera animation
  // actions (attach to the comment, import a file).
  const { frameView, homeView, attachLayout, importLayout } = useSplatInput({
    splat,
    data,
    ann,
    pres,
    selected: editor.selection.selected,
    showEdit,
    canPresent,
    stageMode: state.mode === 'stage',
  });

  // Points of interest: ARMING THE TOOL IS BEING IN PLACEMENT: the next click in the cloud places a point.
  // Same hook, same gesture, same options as the 3D viewer: this is the requested parity, obtained by
  // removing the splat's own path rather than duplicating it.
  const placingPoi = activeTool.id === 'pin';
  usePoiPlacement({
    viewer: splat,
    armed: placingPoi,
    ann,
    onExit: () => update({ tool: DEFAULT_TOOL }),
  });

  /**
   * The edit in progress joins the **next comment**, exactly like the 3D staging proposal: it is the only
   * route once the version is published, and it remains open before. What leaves is the whole gesture:
   * transform, crop volumes, flip, deletions and subset transforms.
   *
   * The editor is a PROVIDER, not a producer of state: the proposal is assembled only at sending time (the
   * mask weighs up to a few hundred kilobytes: encoding it at each render to compare would be absurd), and
   * `sent` removes it from the editor once it has left, otherwise it would join itself to the next comment (46.T).
   */
  const { provideSplatEdit } = ann;
  const { dirty: editDirty, buildProposal, revertEdits } = editor;
  useEffect(() => {
    provideSplatEdit({
      build: () => {
        if (!showEdit || !editDirty) return null;
        // "Modified" does not mean "proposed": a volume added then removed leaves the editor dirty without
        // leaving anything to say. Nothing leaves then, not even an empty object.
        const proposal = buildProposal();
        return hasSplatEditProposal(proposal) ? proposal : null;
      },
      sent: () => {
        if (editDirty) revertEdits();
      },
    });
    return () => provideSplatEdit(null);
  }, [provideSplatEdit, showEdit, editDirty, buildProposal, revertEdits]);

  // Escape releases the proposal of the comment being read: same key and same meaning as on the 3D side.
  const { setViewedSplatEdit } = ann;
  const releaseCommentEdit = useCallback(() => setViewedSplatEdit(null), [setViewedSplatEdit]);
  useCommentSceneEscape(viewedEdit != null, releaseCommentEdit);

  return (
    <ReviewChrome
      kind="SPLAT"
      state={state}
      onState={update}
      role={role ?? 'ARTIST'}
      // The splat's toggle: "Staging" and "Clean up" have left it (`splatChrome`), only "Explore" remains, so
      // it is erased. Same list as that of the numeric keys, so that a segment absent from the header is not
      // armed by the keyboard.
      modes={modes}
      // Second group of the rail: the cloud's editing tools. The "Clean up" segment remains out of the header,
      // but its tools are one click away again (batch 13).
      railExtra={railExtra}
      headerRight={
        <SpatialCompareHeader
          versionId={data.media.versionId}
          mediaId={data.media.id}
          kind="SPLAT"
          versions={compare.versions}
        >
          {compare.enabled && <CompareControl compare={compare} />}
        </SpatialCompareHeader>
      }
      dirty={canSaveForAll ? editor.dirty : undefined}
      onViewAction={(action) => (action === 'fit' ? frameView() : homeView())}
      options={
        <SplatOptions
          tool={activeTool}
          mode={state.mode}
          editor={editor}
          saveForAll={canSaveForAll}
          paint={paint}
          presentation={
            canPresent ? { dirty: animDirty, busy: pres.busy, onSave: () => void pres.save() } : undefined
          }
          poi={ann.poi}
        />
      }
      panel={
        <SplatPanels
          panel={state.panel}
          data={data}
          splat={splat}
          pres={pres}
          editor={editor}
          grid={grid}
          culling={culling}
          exportEdits={
            // Effective edits to bake into the export: those of the editor being edited, otherwise the
            // persisted ones (replayed for everyone), read-only.
            showEdit
              ? { transform: editor.transform, volumes: editor.volumes.serialize() }
              : { transform: saved?.transform ?? null, volumes: saved?.volumes ?? [] }
          }
          onFrame={frameView}
          onHome={homeView}
          onImportAnim={importLayout}
          canPresent={canPresent}
          staging={{
            active: state.mode === 'stage',
            toggle: () => update({ mode: state.mode === 'stage' ? DEFAULT_MODE : 'stage' }),
          }}
        />
      }
      transport={
        <SpatialTransport
          anim={pres.anim}
          editable={canPresent}
          fps={data.fps ?? 24}
          attach={attachLayout}
          drawerOpen={state.drawer === 'curves'}
          onDrawer={() => update({ drawer: state.drawer === 'curves' ? null : 'curves' })}
        />
      }
      drawer={
        state.drawer === 'curves' ? (
          <CurvesDrawer
            anim={pres.anim}
            editable={canPresent}
            fps={data.fps ?? 24}
            height={state.drawerH}
            onHeight={(h) => update({ drawerH: h })}
            onOrbitPreset={canPresent ? () => pres.applyOrbitPreset() : undefined}
          />
        ) : undefined
      }
    >
      {/* Short right-click → viewer menu (framing, point of interest at the targeted point, copy of the view,
          scene settings); held, the same button steals it. The threshold that tells the two apart lives in
          `viewer/contextGesture`. */}
      <SplatContextMenu
        splat={splat}
        frameView={frameView}
        homeView={homeView}
        onPlacePoint={ann.poi.add}
        grid={grid}
        culling={culling}
      >
        <SplatPane
          containerRef={splat.containerRef}
          ready={splat.ready}
          loadError={splat.loadError}
          progress={splat.progress}
          status={data.media.status}
          aspect={frameAspect}
          recording={canPresent && pres.anim.autoKey}
          overlay={overlay}
          notice={
            <Model3DNotice
              placingPoi={placingPoi}
              poiCount={ann.poi.points.length}
              commentScene={viewedEdit != null}
              onReleaseScene={releaseCommentEdit}
            />
          }
          exit={exit}
          settings={<SplatViewerMenus editor={editor} showEdit={showEdit} pres={pres} compare={compare} />}
          pip={
            pres.layout.layoutMode && ready ? (
              <PipFrame label={t('review.layoutCamera')} aspect={frameAspect} onRect={splat.setPipRect} />
            ) : undefined
          }
          editorOverlay={
            paint.armed ? (
              <SurfaceBrushLayer paint={paint} ready={ready} getCanvas={splat.getDom} />
            ) : showEdit && selectTool && ready ? (
              <SelectionOverlay
                tool={selectTool}
                brushRadius={editor.brushRadius}
                getCanvas={() => getSceneHandle()?.dom ?? null}
                onCommit={editor.selection.commitShape}
                onBrush={(point, combine, viewport) =>
                  editor.selection.commitBrush(point, editor.brushRadius, combine, viewport)
                }
                onBrushEnd={editor.selection.endBrush}
              />
            ) : null
          }
        />
      </SplatContextMenu>
    </ReviewChrome>
  );
}

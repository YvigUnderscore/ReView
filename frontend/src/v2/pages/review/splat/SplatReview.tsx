// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReactNode } from 'react';
import type { Role } from '../../../types/api';
import type { MediaResp, SplatEditsPatch } from '../reviewTypes';
import type { Annotations } from '../useAnnotations';
import type { SplatViewer } from './useSplat';
import { useSceneGrid } from '../viewer/useSceneGrid';
import { useCameraSceneRig } from '../camera/sceneRig/useCameraSceneRig';
import PipFrame from '../viewer/PipFrame';
import { DEFAULT_REVIEW_ASPECT } from '../frameRect';
import CompareControl from './compare/CompareControl';
import { useSplatCompare } from './compare/useSplatCompare';
import SpatialCompareHeader from '../three/SpatialCompareHeader';
import PaintOverlay from './paint/PaintOverlay';
import type { SplatPaintState } from './paint/useSplatPaint';
import { usePresentation } from './presentation/usePresentation';
import { useSplatEditor } from './editor/useSplatEditor';
import SelectionOverlay from './editor/selection/SelectionOverlay';
import ReviewChrome from '../chrome/ReviewChrome';
import SplatOptions from '../options/SplatOptions';
import SpatialTransport from '../transport/SpatialTransport';
import CurvesDrawer from '../transport/CurvesDrawer';
import SplatPanels from './SplatPanels';
import { SPLAT_HIDDEN_TOOLS, useSplatChrome } from './useSplatChrome';
import { useSavedSplatEdits } from './useSavedSplatEdits';
import { useSplatInput } from './scene/useSplatInput';
import { useSplatView } from './useSplatView';
import SplatPane from './SplatPane';
import { useT } from '../../../i18n';

/**
 * Bloc splat de la review, monté dans le chrome unifié : rail d'outils à gauche, options de
 * l'outil armé sous l'en-tête, dock inspecteur à droite, transport de l'animation caméra en
 * bas. Plus rien ne flotte au-dessus du nuage — seuls restent les overlays ancrés à la vue
 * (tracés du painter, tracé de sélection, PiP de la caméra layout).
 *
 * L'état métier n'a pas bougé : `useSplatEditor` porte l'édition, `usePresentation` la mise
 * en scène, `useSplatCompare` l'A/B. Le rail se contente d'armer l'outil ; `useSplatChrome`
 * fait suivre les hooks.
 *
 * Ce composant ne calcule plus rien : `useSplatView` tient l'état de vue (chrome, culling,
 * outil de tracé, présentation « non enregistrée ») et `scene/useSplatInput` le câblage
 * pointeur/clavier. Ici, il ne reste que la composition du chrome et des overlays.
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
  const t = useT();
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
  const { ready, getSceneHandle } = splat;

  const grid = useSceneGrid(splat);
  const pres = usePresentation(splat, data, onSaved);
  const compare = useSplatCompare(splat, data.media);
  // État de vue : chrome (mode/outil/panneau), culling, tracé de sélection armé, écart entre
  // l'animation courante et la présentation persistée.
  const { state, update, culling, activeTool, selectTool, animDirty } = useSplatView({
    splat,
    data,
    pres,
    editorTool: editor.tool,
  });

  // Caméra-objet dans la scène (mode layout) : mesh + trajectoire + gizmo des clés.
  const cameraRig = useCameraSceneRig({
    getSceneHandle: splat.getSceneHandle,
    subscribeFrame: splat.subscribeFrame,
    ready: splat.ready,
    active: pres.layout.layoutMode,
    editable: canPresent,
    anim: pres.anim,
    getBasePose: pres.layout.getActivationView,
  });

  useSplatChrome({
    state,
    editor,
    paint,
    focusPick: pres.rig.focusPick,
    onToggleFocusPick: pres.rig.toggleFocusPick,
    cameraRig,
  });

  // Lecture seule : rejeu des éditions persistées (transformation, flip, volumes, masque,
  // sous-ensembles) — l'éditeur les gère lui-même quand il est monté.
  useSavedSplatEdits(splat, data, showEdit);

  // Câblage pointeur/clavier : hotspot au clic, transport caméra, cadrage F/H, palette Ctrl+K,
  // et les deux actions d'animation caméra (joindre au commentaire, importer un fichier).
  const { armHotspot, frameView, homeView, attachLayout, importLayout } = useSplatInput({
    splat,
    data,
    ann,
    pres,
    selected: editor.selection.selected,
    showEdit,
    canPresent,
    stageMode: state.mode === 'stage',
  });

  return (
    <ReviewChrome
      // Verrou de publication : les modes qui altèrent le média sont grisés, pas offerts.
      published={data.media.published}
      kind="SPLAT"
      state={state}
      onState={update}
      role={role ?? 'ARTIST'}
      hiddenTools={SPLAT_HIDDEN_TOOLS}
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
      dirty={showEdit ? editor.dirty : undefined}
      onViewAction={(action) => (action === 'fit' ? frameView() : homeView())}
      options={
        <SplatOptions
          tool={activeTool}
          mode={state.mode}
          editor={editor}
          paint={paint}
          presentation={
            canPresent ? { dirty: animDirty, busy: pres.busy, onSave: () => void pres.save() } : undefined
          }
          onPlaceHotspot={armHotspot}
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
          culling={culling}
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
          canPresent={canPresent}
        />
      }
      transport={
        <SpatialTransport
          anim={pres.anim}
          editable={canPresent}
          fps={data.fps ?? 24}
          onAttach={attachLayout}
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
      <SplatPane
        containerRef={splat.containerRef}
        ready={splat.ready}
        loadError={splat.loadError}
        progress={splat.progress}
        status={data.media.status}
        aspect={data.splatPresentation?.camera?.aspect}
        recording={canPresent && pres.anim.autoKey}
        overlay={overlay}
        pip={
          pres.layout.layoutMode && ready ? (
            <PipFrame
              label={t('review.layoutCamera')}
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

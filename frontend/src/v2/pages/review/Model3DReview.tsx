// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Undo2 } from 'lucide-react';
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
import { useHotspotPlacement } from './three/useHotspotPlacement';
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
import ReviewChrome from './chrome/ReviewChrome';
import { DEFAULT_MODE } from './chrome/modes';
import { useModel3DModes } from './three/useModel3DModes';
import Model3DRenderMenu from './three/Model3DRenderMenu';
import SpatialTransport from './transport/SpatialTransport';
import ClipTransport from './transport/ClipTransport';
import CurvesDrawer from './transport/CurvesDrawer';
import TrackSwitch, { type TrackId } from './transport/TrackSwitch';
import PipFrame from './viewer/PipFrame';
import UsdRecomposeDialog from './UsdRecomposeDialog';
import { useUsdScene } from './three/useUsdScene';
import { normalizeOverride } from './three/sceneOverride';
import { useUsdPicking } from './three/useUsdPicking';
import { DEFAULT_REVIEW_ASPECT } from './frameRect';
import { useT } from '../../i18n';

/**
 * Bloc modèle 3D de la review, monté dans le chrome unifié — mêmes cinq emplacements que le
 * splat, avec un panneau Éclairage en plus (un modèle s'éclaire, un nuage porte sa lumière).
 * Les onze barres flottantes de l'ancien HUD sont réparties entre le rail (gizmos, épingle,
 * caméra-objet), la barre d'options, les cinq panneaux du dock, le popover de rendu au coin
 * haut-gauche du viewer et le transport à deux pistes.
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
}) {
  const t = useT();
  // Scène Three réellement construite (modèle chargé, runtime posé). À ne pas confondre avec
  // « le média est affichable » : les hooks qui lisent la scène de façon impérative n'ont rien
  // à lire tant que le GLB n'est pas chargé, et leur effet ne serait pas rejoué ensuite.
  const ready = model3d.ready;
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
  // Comparaison A/B des modèles 3D : frères de la version **et** modèles d'autres versions
  // cochés dans `CompareSelect` — tous chargés dans la même scène (caméra liée).
  const compare = useModel3DCompare(model3d, data.media);
  // Mesure point-à-point et dimensions réelles (39.G) : l'unité vient de la scène USD.
  const measure = useModelMeasure(model3d, data.modelSource?.usd?.metersPerUnit ?? 1);
  // Mode d'affichage + plan de coupe + HDRI joints à la vue caméra du commentaire.
  useModel3DViewState({ model3d, inspect, section, lighting });
  // Hotspot posé au clic (et non plus au centre de l'écran) : l'outil s'arme, puis on désigne.
  const hotspot = useHotspotPlacement(model3d, (hs) => ann.setHotspot3d(hs));
  // Scenegraph USD + « ReView override » (46.C) : l'override de base du média est rejoué pour
  // tous, l'exploration locale du spectateur reste dans sa session.
  // Mémoïsé : sans cela l'override serait un objet neuf à chaque rendu et la scène serait
  // réappliquée en boucle.
  const commentOverride = useMemo(
    () => normalizeOverride(ann.viewedSceneOverride),
    [ann.viewedSceneOverride],
  );
  const scene = useUsdScene(data, model3d.getSceneHandle, ready, commentOverride, ann.setSceneOverride);
  // Clic droit immobile sur un objet (46.M) : le prim visé alimente le menu qui enveloppe le pane.
  const [primMenu, setPrimMenu] = useState<string | null>(null);
  // `resolvePick` (et non `resolvePrim`) : le clic désigne le component englobant, Alt+clic la
  // feuille exacte. La promotion s'arrête à la résolution du clic — rien d'autre n'en dépend.
  useUsdPicking(model3d.getSceneHandle, ready, scene.select, scene.resolvePick, setPrimMenu);
  // `F` cadre le prim sélectionné (46.I) — le viewer garde son cadrage global sans sélection.
  const { setFrameTarget } = model3d;
  useEffect(() => {
    setFrameTarget(scene.selectedObjects);
    return () => setFrameTarget(null);
  }, [setFrameTarget, scene.selectedObjects]);
  // L'envoi d'un commentaire emporte la proposition (le composer est vidé) : l'exploration
  // locale repart à zéro — comme le hotspot posé. Sans cela, le pied du scenegraph promettrait
  // un delta que le prochain commentaire ne porterait plus. Le commentaire fraîchement créé,
  // une fois sélectionné, rejoue exactement ce qui vient d'être proposé.
  //
  // C'est la **transition** proposition → vide qui signe l'envoi. Réagir à l'état « pas de
  // proposition » seul suffisait à annuler le tout premier delta du gizmo : il arrivait un
  // rendu avant que la proposition n'atteigne le composer, et l'effet voyait « rien de joint
  // + exploration sale » — l'objet revenait à son origine au lâcher de la souris.
  const { revert, dirty: sceneDirty } = scene;
  const hadProposal = useRef(ann.sceneOverride != null);
  useEffect(() => {
    const has = ann.sceneOverride != null;
    if (hadProposal.current && !has && sceneDirty) revert();
    hadProposal.current = has;
  }, [ann.sceneOverride, sceneDirty, revert]);
  // Échap relâche la scène proposée par le commentaire sélectionné (46.T).
  const hasCommentScene = ann.viewedSceneOverride != null;
  const { setViewedSceneOverride } = ann;
  const releaseCommentScene = useCallback(() => setViewedSceneOverride(null), [setViewedSceneOverride]);
  useCommentSceneEscape(hasCommentScene, releaseCommentScene);
  // Recomposition et override USD : réservés aux gestionnaires, et autorisés APRÈS
  // publication (Phase 50) — la couche d'override est rejouée par-dessus le fichier
  // d'origine, qui n'est jamais réécrit. Le verrou ne garde que le montage et le `transform`.
  const [recomposeOpen, setRecomposeOpen] = useState(false);
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

  // Caméra-objet dans la scène (mode layout) : mesh + trajectoire + gizmo d'édition des clés.
  const rig = useCameraSceneRig({
    getSceneHandle: model3d.getSceneHandle,
    subscribeFrame: model3d.subscribeFrame,
    ready,
    active: model3d.layoutMode,
    editable: canManage,
    anim: cam.anim,
    getBasePose: model3d.getActivationView,
  });

  // Bascule et rail du modèle 3D (Phase 50, lot 6) : « Mise en scène » n'y figure plus —
  // l'interrupteur du panneau Caméra l'arme — et « Nettoyer » n'apparaît que si le serveur
  // accorde l'écriture de la transformation.
  const { state, update, modes, tools } = useModel3DModes({
    canEditTransform: showEditTools,
    // Une scène USD donne aux gizmos une seconde cible — l'override de scène par prim (46.N),
    // qui ne passe pas par la transformation de version et n'en a donc pas les droits.
    hasScenegraph: scene.tree.length > 0,
  });
  // Mode Mise en scène = atelier caméra : y entrer active le layout (PiP + caméra-objet), en
  // sortir le désactive. L'interrupteur du panneau Caméra est désormais la seule entrée.
  const { setLayoutMode } = model3d;
  useEffect(() => {
    setLayoutMode(state.mode === 'stage');
  }, [state.mode, setLayoutMode]);

  // Raccourcis du transport caméra (piste caméra seulement — la piste clips a son transport).
  useCameraShortcuts({
    anim: cam.anim,
    active: track === 'camera',
    editable: canManage,
    undoActive: state.mode === 'stage',
    fps: data.fps ?? 24,
  });
  const { history, dirty } = useModel3DChrome({ state, m: model3d, cameraRig: rig, usdScene: scene });

  // Palette Ctrl+K (B3) : commandes cadrer/lecture/clé/orbite, extraites dans leur hook.
  useModel3DCommands(cam, model3d, canManage, !!data.splatPresentation, measure);

  const activeTool = tools.find((t) => t.id === state.tool) ?? tools[0];
  const trackSwitch = (
    <TrackSwitch track={track} onTrack={setTrack} hasClips={model3d.animations.length > 0} />
  );

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
          onPlaceHotspot={hotspot.arm}
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
          onRecompose={canRecompose ? () => setRecomposeOpen(true) : undefined}
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
            onAttach={cam.attach}
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
      {/* Clic droit immobile sur un objet → actions du prim visé (46.M). `useUsdPicking` arrête
          l'événement (vol, clic dans le vide) pour que le menu ne s'ouvre jamais à vide. */}
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className="contents">
            <Model3DThreePane
              status={data.media.status}
              loadError={model3d.loadError}
              containerRef={model3d.containerRef}
              overlay={overlay}
              recording={canManage && cam.anim.autoKey}
              settings={<Model3DRenderMenu inspect={inspect} variants={variants} />}
              aspect={data.splatPresentation?.camera?.aspect}
              pip={
                model3d.layoutMode ? (
                  <PipFrame
                    label={t('review.layoutCamera')}
                    aspect={data.splatPresentation?.camera?.aspect ?? DEFAULT_REVIEW_ASPECT}
                    onRect={model3d.setPipRect}
                  />
                ) : undefined
              }
              canReprocess={role !== 'CLIENT'}
              reprocessing={reprocessing}
              processingError={data.processingError}
              onReprocess={onReprocess}
              notice={
                hotspot.armed ? (
                  <p className="absolute top-2 left-1/2 z-20 -translate-x-1/2 rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground shadow-lg">
                    {t('hotspot.clickToPlace')}
                  </p>
                ) : hasCommentScene ? (
                  <button
                    onClick={() => setViewedSceneOverride(null)}
                    title={t('review.resetScene')}
                    className="absolute top-2 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground shadow-lg ring-2 ring-primary/30 hover:opacity-90"
                  >
                    <Undo2 size={12} /> {t('review.commentScene')}
                    <kbd className="rounded bg-primary-foreground/20 px-1 text-2xs">{t('common.escKey')}</kbd>
                  </button>
                ) : undefined
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

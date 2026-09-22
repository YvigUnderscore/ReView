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
import UsdRecomposeDialog from './UsdRecomposeDialog';
import { useUsdScene } from './three/useUsdScene';
import { normalizeOverride } from './three/sceneOverride';
import { usePrimPointer } from './three/usePrimPointer';
import { mediaReviewAspect } from './reviewAspect';
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
  exit,
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
  /** Sortie de la lecture d'un commentaire annoté — descendue dans le viewer, comme l'overlay. */
  exit: ReactNode;
}) {
  const t = useT();
  // Scène Three réellement construite (modèle chargé, runtime posé). À ne pas confondre avec
  // « le média est affichable » : les hooks qui lisent la scène de façon impérative n'ont rien
  // à lire tant que le GLB n'est pas chargé, et leur effet ne serait pas rejoué ensuite.
  const ready = model3d.ready;
  // Cadre de livraison : ratio des réglages pipeline, sauf aspect déjà gelé (`reviewAspect`).
  const frameAspect = mediaReviewAspect(data).value;
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

  // Scenegraph USD + « ReView override » (46.C) : l'override de base du média est rejoué pour
  // tous, l'exploration locale du spectateur reste dans sa session.
  // Mémoïsé : sans cela l'override serait un objet neuf à chaque rendu et la scène serait
  // réappliquée en boucle.
  const commentOverride = useMemo(
    () => normalizeOverride(ann.viewedSceneOverride),
    [ann.viewedSceneOverride],
  );
  const scene = useUsdScene(data, model3d.getSceneHandle, ready, commentOverride, ann.setSceneOverride);
  // Pointeur du viewer : clic gauche immobile = sélection, clic droit BREF = menu du prim visé
  // (46.M) — maintenu, le même bouton vole. `resolvePick` (et non `resolvePrim`) : le clic
  // désigne le component englobant, Alt+clic la feuille exacte.
  const primMenu = usePrimPointer(model3d, ready, scene.select, scene.resolvePick);
  // `F` cadre le prim sélectionné (46.I) — le viewer garde son cadrage global sans sélection.
  const { setFrameTarget } = model3d;
  useEffect(() => {
    setFrameTarget(scene.selectedObjects);
    return () => setFrameTarget(null);
  }, [setFrameTarget, scene.selectedObjects]);
  // L'envoi d'un commentaire emporte la proposition (le composer est vidé) : l'exploration
  // locale repart à zéro — comme les points posés. Sans cela, le pied du scenegraph promettrait
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
  // Échap relâche la scène proposée par le commentaire sélectionné (46.T). Lu deux fois —
  // ici et par le bandeau du viewer — mais sans nom intermédiaire : le budget de ce fichier
  // est atteint, et le lot 13 y descend la sortie de lecture du commentaire.
  const { setViewedSceneOverride } = ann;
  const releaseCommentScene = useCallback(() => setViewedSceneOverride(null), [setViewedSceneOverride]);
  useCommentSceneEscape(ann.viewedSceneOverride != null, releaseCommentScene);
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
    editable: canManage,
    anim: cam.anim,
    layout: model3d.layout,
  });

  // Bascule et rail du modèle 3D (Phase 50, lot 6) : « Mise en scène » n'y figure plus —
  // l'interrupteur du panneau Caméra l'arme — et « Nettoyer » n'apparaît que si le serveur
  // accorde l'écriture de la transformation.
  // Une scène USD donne aux gizmos une seconde cible — l'override de scène par prim (46.N), qui
  // ne passe pas par la transformation de version et n'en a donc pas les droits. `isFlying` est
  // la garde de vol du chrome : clic droit maintenu, aucune lettre n'arme d'outil.
  const { state, update, modes, tools } = useModel3DModes(
    { canEditTransform: showEditTools, hasScenegraph: scene.tree.length > 0 },
    model3d.isFlying,
  );
  // Mode Mise en scène = atelier caméra : y entrer sort de la caméra du plan, en sortir y rentre.
  // Seule écriture du « dans / hors caméra » — modèle en tête de `viewer/useLayoutMode`.
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
  // Points d'intérêt : ARMER L'OUTIL, C'EST ÊTRE EN PLACEMENT — le clic suivant dans la vue
  // pose un point, sans bouton intermédiaire. Même hook et même geste que sur le splat.
  const placingPoi = activeTool.id === 'pin';
  usePoiPlacement({
    viewer: model3d,
    armed: placingPoi,
    poi: ann.poi,
    showingDraft: ann.viewedPoi.length === 0,
    onExit: () => update({ tool: DEFAULT_TOOL }),
  });
  const hasClips = model3d.animations.length > 0;
  const trackSwitch = <TrackSwitch track={track} onTrack={setTrack} hasClips={hasClips} />;

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
      {/* Clic droit bref sur un objet → actions du prim visé (46.M). `useSpatialContextMenu`
          arrête l'événement du canvas (vol, clic dans le vide) : le menu ne s'ouvre jamais à
          vide, et jamais au milieu d'un vol. */}
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className="contents">
            <Model3DThreePane
              status={data.media.status}
              loadError={model3d.loadError}
              containerRef={model3d.containerRef}
              overlay={overlay}
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

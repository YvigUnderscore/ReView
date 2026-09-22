// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, type ReactNode } from 'react';
import type { Role } from '../../../types/api';
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
import { useT } from '../../../i18n';

/**
 * Bloc splat de la review, monté dans le chrome unifié : rail d'outils à gauche, options de
 * l'outil armé sous l'en-tête, dock inspecteur à droite, transport de l'animation caméra en
 * bas. Plus rien ne flotte au-dessus du nuage — seuls restent les overlays ancrés à la vue
 * (traits de la brosse 3D, tracé de sélection, PiP de la caméra layout).
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
  exit,
  ann,
}: {
  data: MediaResp;
  splat: SplatViewer;
  /** Éditeur monté (gestionnaire + viewer prêt) — publié ou non : l'édition reste offerte. */
  showEdit: boolean;
  /** Gestionnaire : peut persister la présentation (autorisé même publié — mise en scène). */
  canPresent: boolean;
  /** Brosse de surface 3D — instanciée par la page (les traits partent avec le commentaire). */
  paint: SplatPaintState;
  onSaved: (patch: SplatEditsPatch) => void;
  /** Rôle du spectateur — le client ne voit pas la bascule de mode. */
  role?: Role;
  overlay: ReactNode;
  /** Sortie de la lecture d'un commentaire annoté — descendue dans le viewer, comme l'overlay. */
  exit: ReactNode;
  /** Annotations (mode layout : joindre/rejouer une animation caméra dans les commentaires). */
  ann: Annotations;
}) {
  const t = useT();
  const saved = data.splatEdits;
  /**
   * Écrire les éditions du nuage POUR TOUT LE MONDE s'arrête à la publication — la même ligne
   * que le modèle 3D, et la même que le serveur applique désormais (`lib/publishLock`). Dans un
   * studio qui n'utilise pas les brouillons, le média naît publié : aucun bouton « Enregistrer »
   * ne paraît donc jamais au-dessus du viewer, sans qu'il ait fallu inventer une seconde règle.
   * Éditer, en revanche, reste offert : l'édition part dans un commentaire.
   */
  const canSaveForAll = showEdit && !data.media.published;
  /** Proposition d'édition portée par le commentaire sélectionné — rejouée, jamais écrite. */
  const viewedEdit = ann.viewedSplatEdit;
  const editor = useSplatEditor(
    splat,
    data.media.id,
    saved,
    data.splatMaskUrl,
    data.splatSubsetUrl,
    onSaved,
    showEdit,
    // Lire la proposition d'un commentaire suspend l'éditeur : un seul nuage, et c'est le
    // commentaire qui parle. L'édition locale revient intacte à la sortie.
    viewedEdit != null,
  );
  const { ready, getSceneHandle } = splat;
  // Cadre de livraison : ratio des réglages pipeline, sauf aspect déjà gelé (`reviewAspect`).
  const frameAspect = mediaReviewAspect(data).value;

  const grid = useSceneGrid(splat);
  const pres = usePresentation(splat, data, onSaved);
  const compare = useSplatCompare(splat, data.media);
  // État de vue : chrome (mode/outil/panneau), culling, tracé de sélection armé, écart entre
  // l'animation courante et la présentation persistée.
  const { state, update, modes, culling, activeTool, railExtra, selectTool, animDirty } = useSplatView({
    splat,
    data,
    pres,
    editorTool: editor.tool,
    showEdit,
  });
  // Bouton « Annoter » du composer ↔ mode « Annoter » du rail : sans ce pont, cliquer « Annoter »
  // sur un nuage n'armait que le crayon 2D et les outils de la scène restaient invisibles.
  useSpatialAnnotate({ state, update, ann });

  // Caméra-objet dans la scène (mode layout) : mesh + trajectoire + gizmo des clés.
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

  // Rejeu des éditions en lecture (transformation, flip, volumes, masque, sous-ensembles) : celles
  // du média hors éditeur, celles d'un commentaire dès qu'il en propose — gestionnaire compris.
  useSavedSplatEdits(splat, data, showEdit, viewedEdit);

  // Câblage pointeur/clavier : transport caméra, cadrage F/H, palette Ctrl+K, et les deux
  // actions d'animation caméra (joindre au commentaire, importer un fichier).
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

  // Points d'intérêt : ARMER L'OUTIL, C'EST ÊTRE EN PLACEMENT — le clic suivant dans le nuage
  // pose un point. Même hook, même geste, mêmes options que le viewer 3D : c'est la parité
  // demandée, obtenue en supprimant le chemin propre au splat plutôt qu'en le doublant.
  const placingPoi = activeTool.id === 'pin';
  usePoiPlacement({
    viewer: splat,
    armed: placingPoi,
    ann,
    onExit: () => update({ tool: DEFAULT_TOOL }),
  });

  /**
   * L'édition en cours se joint au **prochain commentaire**, exactement comme la proposition de
   * mise en scène 3D : c'est la seule voie une fois la version publiée, et elle reste ouverte
   * avant. Ce qui part est le geste entier — transformation, volumes de crop, flip, suppressions
   * et transformations de sous-ensembles.
   *
   * L'éditeur est FOURNISSEUR, et non producteur d'un état : la proposition n'est assemblée
   * qu'à l'envoi (le masque pèse jusqu'à quelques centaines de kilo-octets — l'encoder à chaque
   * rendu pour le comparer serait absurde), et `sent` la retire de l'éditeur quand elle est
   * partie, sans quoi elle se rejoindrait d'elle-même au commentaire suivant (46.T).
   */
  const { provideSplatEdit } = ann;
  const { dirty: editDirty, buildProposal, revertEdits } = editor;
  useEffect(() => {
    provideSplatEdit({
      build: () => {
        if (!showEdit || !editDirty) return null;
        // « Modifié » ne veut pas dire « proposé » : un volume ajouté puis retiré laisse
        // l'éditeur sale sans rien laisser à dire. Rien ne part alors, pas même un objet vide.
        const proposal = buildProposal();
        return hasSplatEditProposal(proposal) ? proposal : null;
      },
      sent: () => {
        if (editDirty) revertEdits();
      },
    });
    return () => provideSplatEdit(null);
  }, [provideSplatEdit, showEdit, editDirty, buildProposal, revertEdits]);

  // Échap relâche la proposition du commentaire lu — même touche et même sens que côté 3D.
  const { setViewedSplatEdit } = ann;
  const releaseCommentEdit = useCallback(() => setViewedSplatEdit(null), [setViewedSplatEdit]);
  useCommentSceneEscape(viewedEdit != null, releaseCommentEdit);

  return (
    <ReviewChrome
      kind="SPLAT"
      state={state}
      onState={update}
      role={role ?? 'ARTIST'}
      // La bascule du splat : « Mise en scène » et « Nettoyer » l'ont quittée (`splatChrome`),
      // il n'y reste qu'« Explorer » — elle s'efface donc. Même liste que celle des touches
      // numériques, pour qu'un segment absent de l'en-tête ne s'arme pas au clavier.
      modes={modes}
      // Second groupe du rail : les outils d'édition du nuage. Le segment « Nettoyer » reste hors
      // de l'en-tête, mais ses outils sont de nouveau à un clic (lot 13).
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
      {/* Clic droit BREF → menu du viewer (cadrage, point d'intérêt au point visé, copie de la
          vue, réglages de scène) ; maintenu, le même bouton vole. Le seuil qui départage les deux
          vit dans `viewer/contextGesture`. */}
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

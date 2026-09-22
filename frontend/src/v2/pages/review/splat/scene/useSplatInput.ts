// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { useCameraShortcuts } from '../../camera/useCameraShortcuts';
import type { MediaResp } from '../../reviewTypes';
import { importCameraFile } from '../../three/importCameraAbc';
import type { Annotations } from '../../useAnnotations';
import { frameCameraToSphere } from '../../viewer/frameCamera';
import { useFrameShortcuts } from '../../viewer/useFrameShortcuts';
import { meshBounds, selectionBounds } from '../editor/selection/bounds';
import type { PresentationState } from '../presentation/usePresentation';
import type { SplatViewer } from '../useSplat';
import { useSplatCommands } from '../useSplatCommands';
import { frameCameraToMesh } from './frameCamera';
import { useT } from '../../../../i18n';

export interface SplatInput {
  /** Cadre la sélection si présente (édition), sinon le splat visible — touche F. */
  frameView: () => void;
  /** Rétablit la vue d'origine (cadrage automatique du mesh) — touche H. */
  homeView: () => void;
  /**
   * Joint — ou détache — l'animation caméra du commentaire en cours de rédaction, et dit si elle
   * l'est déjà : le bouton du transport allume cet état, sans quoi seul un toast l'annonçait.
   */
  attachLayout: { toggle: () => void; attached: boolean };
  /** Importe une animation caméra (.abc) et la joue aussitôt. */
  importLayout: (file: File) => void;
}

/**
 * Câblage pointeur/clavier du bloc splat : transport caméra, cadrage F/H, palette Ctrl+K, et les
 * deux actions d'animation caméra (joindre au commentaire, importer un fichier). Extrait de
 * `SplatReview` (budget lignes) — le composant compose, il ne câble plus.
 *
 * La pose des points d'intérêt n'est plus ici : elle suit l'outil du rail (`poi/usePoiPlacement`,
 * appelé par `SplatReview`), exactement comme dans le viewer 3D.
 *
 * L'ordre de montage reprend celui d'avant l'extraction (transport caméra avant cadrage F/H) :
 * ces hooks posent des écouteurs clavier sur `window`, et on ne présume pas que l'ordre
 * d'inscription soit indifférent.
 */
export function useSplatInput({
  splat,
  data,
  ann,
  pres,
  selected,
  showEdit,
  canPresent,
  stageMode,
}: {
  splat: SplatViewer;
  data: MediaResp;
  /** Annotations : animation caméra jointe au commentaire, et celle du commentaire relu. */
  ann: Annotations;
  pres: PresentationState;
  /** Sélection de l'éditeur — F cadre dessus quand elle n'est pas vide. */
  selected: ReadonlySet<number>;
  /** Éditeur monté : il gère déjà F/H (sélection), les raccourcis viewer restent inertes. */
  showEdit: boolean;
  /** Gestionnaire : peut poser des clés et éditer la mise en scène. */
  canPresent: boolean;
  /** Mode « Mise en scène » actif : Ctrl+Z pilote l'historique de l'animation. */
  stageMode: boolean;
}): SplatInput {
  const t = useT();
  const { ready, getSceneHandle } = splat;

  // Raccourcis du transport caméra : Espace, K, ←/→, Début/Fin ; Ctrl+Z de l'anim en mode Layout.
  useCameraShortcuts({
    anim: pres.anim,
    active: true,
    editable: canPresent,
    undoActive: stageMode,
    fps: data.fps ?? 24,
  });

  // Mode layout : rejoue l'animation caméra jointe au commentaire sélectionné.
  const { setAnim: animSetAnim, play: animPlay } = pres.anim;
  const viewedCameraAnim = ann.viewedCameraAnim;
  useEffect(() => {
    if (viewedCameraAnim) {
      animSetAnim(viewedCameraAnim);
      animPlay();
    }
  }, [viewedCameraAnim, animSetAnim, animPlay]);

  // Joindre / détacher : le bouton porte l'état, il doit donc aussi savoir le défaire. Et rien
  // ne part plus en silence — un appui sans animation le dit au lieu de ne rien faire.
  const toggleAttach = useCallback(() => {
    if (ann.cameraAnim) {
      ann.setCameraAnim(null);
      toast.info(t('review.camera.detached'));
      return;
    }
    if (!pres.anim.hasAnimation) {
      toast.warning(t('review.camera.nothingToAttach'));
      return;
    }
    ann.setCameraAnim(pres.anim.anim);
    toast.success(t('review.camera.attached'));
  }, [pres.anim, ann, t]);

  const importLayout = useCallback(
    (file: File) => {
      void importCameraFile(file)
        .then((animData) => {
          if (!animData) {
            toast.error(t('review.camera.none'));
            return;
          }
          pres.anim.setAnim(animData);
          pres.anim.play();
          toast.success(t('review.camera.imported'));
        })
        .catch(() => toast.error(t('review.camera.importFailed')));
    },
    [pres.anim, t],
  );

  // Cadrage F/H, actif pour **tous** (y compris en review post-publish) : F cadre la sélection
  // si présente (édition), sinon le splat visible ; H rétablit la vue d'origine.
  const frameView = useCallback(() => {
    const handle = getSceneHandle();
    if (!handle) return;
    const bounds = (selected.size ? selectionBounds(handle, selected) : null) ?? meshBounds(handle);
    if (bounds) frameCameraToSphere(handle.camera, handle.controls, bounds.center, bounds.radius);
  }, [getSceneHandle, selected]);
  const homeView = useCallback(() => {
    const handle = getSceneHandle();
    if (handle) frameCameraToMesh(handle.THREE, handle.mesh, handle.camera, handle.controls);
  }, [getSceneHandle]);

  // Raccourcis F/H côté viewer (post-publish). En édition, l'éditeur gère déjà F/H (sélection).
  useFrameShortcuts({
    active: !showEdit && ready,
    isFlying: splat.isFlying,
    onFrame: frameView,
    onHome: homeView,
  });

  // Palette Ctrl+K (B3) : les actions du viewer, sans bouton de plus.
  useSplatCommands({
    pres,
    frameView,
    homeView,
    canPresent,
    hasPresentation: !!data.splatPresentation,
  });

  // L'action et son état partent ensemble : le bouton du transport doit dire ce qui est joint.
  const attachLayout = { toggle: toggleAttach, attached: ann.cameraAnim != null };
  return { frameView, homeView, attachLayout, importLayout };
}

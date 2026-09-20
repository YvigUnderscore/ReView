// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SplatCamera } from '../reviewTypes';
import type { CameraController } from '../camera/useCameraAnim';
import { suspendAutoKey } from '../camera/autoKeyGate';

/**
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * LE MODÈLE « DANS / HORS CAMÉRA » — source de vérité. Commun 3D et splat.
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Il y a **deux caméras** dans la scène et **une** animation. Ce hook décide, à chaque instant,
 * laquelle des deux est « la caméra du plan » — celle que l'animation pilote et que l'on
 * échantillonne en posant une clé.
 *
 * - **DANS la caméra** (`layoutMode` éteint) : la caméra du plan **est** la caméra principale,
 *   celle que l'on manipule à la souris. Le lecteur keyframe la pilote, une clé l'échantillonne :
 *   tout coïncide, il n'y a rien à arbitrer.
 * - **HORS caméra** (`layoutMode` allumé) : la caméra principale devient libre — on regarde le
 *   plateau de l'extérieur. La caméra du plan est alors la caméra layout, rendue dans le PiP, et
 *   elle n'est plus manipulable à la souris : elle se règle par le gizmo de la caméra-objet, par
 *   le curve editor, par la focale/le tilt du panneau. On n'y voit rien d'autre que ce que
 *   l'animation dit.
 *
 * QUI POSSÈDE QUOI
 * - Le **mode** est écrit par un seul appelant par viewer : la bascule de mode du chrome
 *   (`state.mode === 'stage'`), que l'interrupteur du panneau Caméra pilote lui aussi. `setLayoutMode`
 *   n'est donc appelé qu'à un endroit ; `layoutMode` est lu partout (PiP, caméra-objet, panneau).
 * - La **pose du plan** (`shotPoseRef`) est tenue ici. Elle est écrite par *tout* ce qui applique
 *   une pose à la caméra layout, via `applyShot` : le lecteur (lecture/scrub, à travers
 *   `restoreCamera`) et, hors lecture, le rig de scène qui échantillonne l'animation à chaque
 *   frame (`useCameraSceneRig`). C'est ce qui fait que le PiP suit **toute** édition — gizmo,
 *   touche K, drag de courbe, tangente, collage, annulation — et plus seulement la lecture.
 * - La **capture** (`layoutController.captureCamera`) rend cette pose hors caméra, et la caméra
 *   principale dans la caméra. `captureCamera` et `restoreCamera` visent enfin la même caméra :
 *   poser une clé hors caméra échantillonnait la caméra libre, jamais celle du PiP.
 *
 * CE QUI EST INTERDIT HORS CAMÉRA
 * - L'**auto-key** est suspendu (`camera/autoKeyGate`) : orbiter la caméra libre ne décrit pas le
 *   plan, et le `pointerup` d'un drag de gizmo écrasait la clé que le gizmo venait d'écrire.
 *
 * ENTRÉE ET SORTIE
 * - À l'entrée, la vue courante est retenue (`getActivationView`) : la caméra layout et la
 *   caméra-objet s'y posent tant qu'aucune clé n'existe, sinon une animation vide échantillonnerait
 *   l'origine et il n'y aurait rien à manipuler au premier contact.
 * - À la sortie, la caméra principale se pose **sur la pose du plan** : on rentre dans la caméra
 *   qu'on vient de régler, au lieu de rester là où la vue libre traînait.
 *
 * Divergences assumées entre les deux viewers : la 2ᵉ passe scissor du PiP est gardée par le mode
 * côté 3D (`useModelLayout.renderPip`) et par la seule présence du rectangle côté splat (la
 * fenêtre `PipFrame` n'étant montée qu'en mode layout, et remontant `null` au démontage).
 */
export function useLayoutMode(opts: {
  subscribeFrame: CameraController['subscribeFrame'];
  getDom: CameraController['getDom'];
  /** Capture de la caméra **principale** (jamais celle du plan — cf. `captureShot`). */
  captureCamera: CameraController['captureCamera'];
  /** Applique une pose à la caméra principale (dans la caméra). */
  restoreMain: (state: unknown) => void;
  /** Applique une pose à la caméra layout du PiP (hors caméra). */
  restoreLayout: (state: unknown) => void;
}) {
  const { subscribeFrame, getDom, captureCamera, restoreMain, restoreLayout } = opts;
  const [layoutMode, setLayoutModeState] = useState(false);
  const layoutModeRef = useRef(false);
  const activationViewRef = useRef<SplatCamera | null>(null);
  // Dernière pose appliquée à la caméra du plan : ce que le PiP montre, donc ce qu'une clé
  // échantillonne. Enregistrée telle quelle — aucune relecture depuis la caméra Three, qui
  // perdrait la distance de la cible (une caméra nue ne porte pas son point de visée).
  const shotPoseRef = useRef<SplatCamera | null>(null);

  /** Applique une pose à la caméra du plan **et** la retient. Unique écriture du PiP. */
  const applyShot = useCallback(
    (pose: SplatCamera) => {
      shotPoseRef.current = pose;
      restoreLayout(pose);
    },
    [restoreLayout],
  );

  const setLayoutMode = useCallback(
    (on: boolean) => {
      if (layoutModeRef.current === on) return;
      setLayoutModeState(on);
      layoutModeRef.current = on;
      if (on) {
        // Entrée : la caméra du plan part de la vue courante (le PiP démarre cohérent).
        const view = captureCamera();
        activationViewRef.current = view ?? null;
        if (view) applyShot(view);
        return;
      }
      // Sortie : on rentre dans la caméra, donc sur sa pose.
      const pose = shotPoseRef.current;
      if (pose) restoreMain(pose);
    },
    [captureCamera, applyShot, restoreMain],
  );

  // Entrée avant que la scène ne soit prête (chrome rouvert en mode « Mise en scène ») : la vue
  // n'est pas encore capturable, et la caméra du plan resterait à l'origine. On réessaie sur les
  // premières frames, puis on se retire de la boucle.
  useEffect(() => {
    if (!layoutMode || activationViewRef.current) return;
    let off: (() => void) | undefined = subscribeFrame(() => {
      const view = captureCamera();
      if (!view) return;
      activationViewRef.current = view;
      applyShot(view);
      off?.();
      off = undefined;
    });
    return () => off?.();
  }, [layoutMode, subscribeFrame, captureCamera, applyShot]);

  // L'auto-key ne suit pas les gestes du canvas hors caméra (cf. `camera/autoKeyGate`).
  useEffect(() => {
    suspendAutoKey(layoutMode);
    return () => suspendAutoKey(false);
  }, [layoutMode]);

  const restoreCamera = useCallback(
    (state: unknown) => {
      if (!layoutModeRef.current) {
        restoreMain(state);
        return;
      }
      applyShot(state as SplatCamera);
    },
    [applyShot, restoreMain],
  );

  /**
   * Capture de la caméra du plan : la pose montrée dans le PiP hors caméra, la caméra principale
   * dans la caméra. C'est elle que `useCameraAnim` échantillonne pour poser une clé.
   */
  const captureShot = useCallback((): SplatCamera | undefined => {
    if (!layoutModeRef.current) return captureCamera();
    return shotPoseRef.current ?? activationViewRef.current ?? captureCamera();
  }, [captureCamera]);

  /** Vue capturée à l'entrée du mode — pose de repli des canaux sans clé. */
  const getActivationView = useCallback(() => activationViewRef.current, []);

  const layoutController = useMemo<CameraController>(
    () => ({ subscribeFrame, getDom, captureCamera: captureShot, restoreCamera }),
    [subscribeFrame, getDom, captureShot, restoreCamera],
  );

  return {
    layoutMode,
    layoutModeRef,
    setLayoutMode,
    layoutController,
    getActivationView,
    /** Écriture de la caméra du plan par le rig de scène (hors lecture) — cf. le modèle ci-dessus. */
    applyShot,
  };
}

export type LayoutModeState = ReturnType<typeof useLayoutMode>;

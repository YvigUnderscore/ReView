// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import type { MarkerHandlers } from '../three/objectHotspot';
import type { Hotspot3D } from '../reviewTypes';
import { isClickGesture } from '../three/usdPicking';
import type { Annotations } from '../useAnnotations';
import { useT } from '../../../i18n';

/**
 * Contrat minimal d'un viewer spatial capable de porter des points d'intérêt — le modèle 3D
 * comme le splat le remplissent, et c'est ce qui rend l'implémentation **unique**.
 */
export interface PoiViewer {
  ready: boolean;
  getSceneHandle: () => { dom: HTMLElement } | null;
  hotspotAtPointer: (clientX: number, clientY: number) => Hotspot3D | null;
  /** Arme (ou désarme) le déplacement et la désignation des pastilles de la scène. */
  setPoiHandlers: (handlers: MarkerHandlers | null) => void;
  /** Rang de la pastille mise en avant, ou `null`. */
  setPoiActive: (index: number | null) => void;
}

/**
 * Pose des points d'intérêt **au clic**, dans les deux viewers spatiaux.
 *
 * Ce qui change en Phase 50 (lot 12) : `armed` n'est plus un état local basculé par un bouton
 * de la barre d'options, c'est l'OUTIL DU RAIL. Armer l'outil, c'est être en placement — le
 * clic suivant dans la vue pose un point, sans bouton intermédiaire. C'était la première
 * demande de l'utilisateur, et c'est aussi ce qui a débloqué le splat, où le bouton était le
 * seul chemin et où rien ne disait que le viewer attendait un clic.
 *
 * Un clic dans le vide ne pose rien (et le dit) ; un glissement reste une orbite ; Échap sort
 * du placement (`onExit`, qui rend l'outil de repos au rail). Tant qu'un point est en
 * préparation, les pastilles sont manipulables : les tirer les déplace, les cliquer désigne la
 * rangée qu'on édite.
 */
export function usePoiPlacement({
  viewer,
  armed,
  ann,
  onExit,
}: {
  viewer: PoiViewer;
  /** L'outil « Point d'intérêt » est armé dans le rail : le viewer est EN PLACEMENT. */
  armed: boolean;
  /**
   * Le composer ET la lecture : le hook y prend son brouillon (`ann.poi`) et ce qu'un commentaire
   * relu affiche (`ann.viewedPoi`). Les deux viewers passaient les mêmes dérivations, mot pour
   * mot — la règle vit ici une seule fois.
   */
  ann: Annotations;
  /** Échap : le rail reprend son outil de repos. */
  onExit: () => void;
}): void {
  const t = useT();
  const { ready, getSceneHandle, hotspotAtPointer, setPoiHandlers, setPoiActive } = viewer;
  const { poi, setViewedPoi } = ann;
  /*
   * Ce qui est à l'écran : les points du commentaire relu s'il y en a un, sinon le brouillon
   * (`usePoiDisplay` leur donne la priorité — cliquer un commentaire doit le montrer, même au
   * milieu d'une rédaction).
   *
   * Deux conséquences, et c'est tout le rôle de ce drapeau : les pastilles d'un commentaire relu
   * restent INERTES (tirer la pastille n° 1 déplacerait un point du brouillon que l'on ne voit
   * pas), et armer l'outil les RELÂCHE — armer, c'est vouloir poser ses propres points, et depuis
   * qu'un mouvement de vue ne les efface plus, rien d'autre ne leur cède la place.
   */
  const showingDraft = ann.viewedPoi.length === 0;
  // Les rappels changent à chaque rendu (la liste de points bouge) : les rejouer par une ref
  // évite de réinstaller les écouteurs au milieu d'un geste.
  const live = useRef({ poi, onExit, t });
  useEffect(() => {
    live.current = { poi, onExit, t };
  });

  useEffect(() => {
    if (armed && !showingDraft) setViewedPoi([]);
  }, [armed, showingDraft, setViewedPoi]);

  // Pastilles manipulables tant qu'un point du brouillon est à l'écran ; inertes sinon (relecture).
  const editable = showingDraft && poi.points.length > 0;
  useEffect(() => {
    if (!ready) return;
    if (!editable) {
      setPoiHandlers(null);
      return;
    }
    const handlers: MarkerHandlers = {
      onMove: (index, clientX, clientY) => {
        const hotspot = hotspotAtPointer(clientX, clientY);
        if (!hotspot) toast.error(live.current.t('poi.noSurface'));
        else live.current.poi.move(index, hotspot);
      },
      onSelect: (index) => {
        const point = live.current.poi.points[index];
        if (point) live.current.poi.setActiveKey(point.key);
      },
      label: (index) => live.current.t('poi.pointLabel', { n: index + 1 }),
    };
    setPoiHandlers(handlers);
    return () => setPoiHandlers(null);
  }, [ready, editable, hotspotAtPointer, setPoiHandlers]);

  // Rang mis en avant : la scène et la rangée du composeur signalent le même point.
  const activeIndex = poi.points.findIndex((p) => p.key === poi.activeKey);
  useEffect(() => {
    setPoiActive(activeIndex >= 0 ? activeIndex : null);
  }, [activeIndex, setPoiActive]);

  useEffect(() => {
    if (!armed || !ready) return;
    const dom = getSceneHandle()?.dom;
    if (!dom) return;
    const previousCursor = dom.style.cursor;
    dom.style.cursor = 'crosshair';
    let down: { x: number; y: number } | null = null;

    const onDown = (e: PointerEvent) => {
      if (e.button === 0) down = { x: e.clientX, y: e.clientY };
    };
    const onUp = (e: PointerEvent) => {
      const start = down;
      down = null;
      // Clic gauche immobile seulement : un glissement reste une orbite.
      if (e.button !== 0 || !start || !isClickGesture(e.clientX - start.x, e.clientY - start.y)) return;
      const hotspot = hotspotAtPointer(e.clientX, e.clientY);
      if (!hotspot) {
        toast.error(live.current.t('poi.noSurface'));
        return;
      }
      live.current.poi.add(hotspot);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') live.current.onExit();
    };

    dom.addEventListener('pointerdown', onDown);
    dom.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey);
    return () => {
      dom.style.cursor = previousCursor;
      dom.removeEventListener('pointerdown', onDown);
      dom.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey);
    };
  }, [armed, ready, getSceneHandle, hotspotAtPointer]);
}

import { useEffect, useRef } from 'react';
import type { ViewerSceneHandle } from '../viewer/sceneHandle';
import { isClickGesture, pickPrim, toNdc } from './usdPicking';

/**
 * Sélection d'un prim au clic dans le viewer 3D (Phase 46, 46.C).
 *
 * Le clic gauche pilote aussi l'orbite : on n'interprète le geste comme une sélection que si
 * le pointeur n'a pas bougé entre l'appui et le relâchement. Un clic dans le vide désélectionne,
 * comme dans un DCC.
 *
 * La position d'appui vit dans une **ref** et non dans la portée de l'effet : le hook du viewer
 * renvoie un objet neuf à chaque rendu, donc un rendu survenant entre l'appui et le relâchement
 * réinstallerait les écouteurs et ferait perdre l'origine du geste — tout clic passerait alors
 * pour un glissement. Pour la même raison, l'effet ne dépend que de `getSceneHandle`, stable.
 */
export function useUsdPicking(
  getSceneHandle: () => ViewerSceneHandle | null,
  ready: boolean,
  onSelect: (path: string | null) => void,
): void {
  const down = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!ready) return;
    const handle = getSceneHandle();
    const dom = handle?.dom;
    const root = handle?.modelObject;
    if (!handle || !dom || !root) return;

    const onDown = (e: PointerEvent) => {
      down.current = { x: e.clientX, y: e.clientY };
    };
    const onUp = (e: PointerEvent) => {
      const start = down.current;
      down.current = null;
      if (e.button !== 0 || !start) return;
      if (!isClickGesture(e.clientX - start.x, e.clientY - start.y)) return;
      const rect = dom.getBoundingClientRect();
      onSelect(pickPrim(handle.THREE, handle.camera, root, toNdc(e.clientX, e.clientY, rect)));
    };

    dom.addEventListener('pointerdown', onDown);
    dom.addEventListener('pointerup', onUp);
    return () => {
      dom.removeEventListener('pointerdown', onDown);
      dom.removeEventListener('pointerup', onUp);
    };
  }, [getSceneHandle, ready, onSelect]);
}

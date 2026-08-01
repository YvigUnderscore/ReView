import { useEffect } from 'react';
import type { Model3DThreeState } from './useModel3DThree';
import { isClickGesture, pickPrim, toNdc } from './usdPicking';

/**
 * Sélection d'un prim au clic dans le viewer 3D (Phase 46, 46.C).
 *
 * Le clic gauche pilote aussi l'orbite : on n'interprète donc le geste comme une sélection
 * que si le pointeur n'a pas bougé entre l'appui et le relâchement. Un clic dans le vide
 * désélectionne, comme dans un DCC.
 */
export function useUsdPicking(
  model3d: Model3DThreeState,
  ready: boolean,
  onSelect: (path: string | null) => void,
): void {
  useEffect(() => {
    if (!ready) return;
    const handle = model3d.getSceneHandle();
    const dom = handle?.dom;
    const root = handle?.modelObject;
    if (!handle || !dom || !root) return;

    let downX = 0;
    let downY = 0;
    const onDown = (e: PointerEvent) => {
      downX = e.clientX;
      downY = e.clientY;
    };
    const onUp = (e: PointerEvent) => {
      if (e.button !== 0) return;
      if (!isClickGesture(e.clientX - downX, e.clientY - downY)) return;
      const rect = dom.getBoundingClientRect();
      onSelect(pickPrim(handle.THREE, handle.camera, root, toNdc(e.clientX, e.clientY, rect)));
    };

    dom.addEventListener('pointerdown', onDown);
    dom.addEventListener('pointerup', onUp);
    return () => {
      dom.removeEventListener('pointerdown', onDown);
      dom.removeEventListener('pointerup', onUp);
    };
  }, [model3d, ready, onSelect]);
}

// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Frame } from 'lucide-react';
import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from '../../../components/ui/context-menu';
import type { UsdBakedVariant, UsdModelInfo } from '../../../types/api';
import { isHidden } from '../three/sceneOverride';
import { isSelfOrDescendant } from '../three/usdScenegraph';
import { variantOptionAvailable } from '../three/variantAvailability';
import type { UsdSceneState } from '../three/useUsdScene';
import { useT } from '../../../i18n';

/**
 * Actions d'un prim USD (46.E/46.M) — contenu **partagé** entre le clic droit d'une ligne du
 * scenegraph et le clic droit sur l'objet dans le viewer : variantes, visibilité, isolement,
 * réinitialisation. Un seul endroit décide de ce qu'on peut faire d'un prim.
 */
export default function PrimMenuItems({
  scene,
  usd,
  baked,
  path,
  onFrame,
}: {
  scene: UsdSceneState;
  usd: UsdModelInfo | null;
  /** Options réellement cuites dans le GLB (46.P) — les autres sont grisées, pas mensongères. */
  baked?: readonly UsdBakedVariant[] | null;
  path: string;
  /** Cadrer la vue sur ce prim — proposé depuis le viewer, où la caméra est le contexte. */
  onFrame?: () => void;
}) {
  const t = useT();
  // Les jeux de variantes du prim **et de ses ancêtres** : on clique un mesh, mais la variante
  // est portée plus haut (`/World/Asset`) — c'est là qu'elle doit être écrite pour s'appliquer.
  const sets = (usd?.variantSets ?? []).filter((v) => isSelfOrDescendant(path, v.prim));
  const hidden = isHidden(scene.override, path);

  return (
    <>
      {sets.map((set) => (
        <ContextMenuSub key={`${set.prim}:${set.name}`}>
          <ContextMenuSubTrigger>Variante · {set.name}</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {set.options.map((option) => {
              const available = variantOptionAvailable(baked, set.prim, set.name, option, set.selected);
              // Combinaison avec les options retenues des autres jeux du prim : la cuisson
              // compose chaque option avec les défauts — deux options non-défaut ensemble
              // n'existent pas dans le GLB, la choisir ferait disparaître l'objet (46.U).
              const renderable = available && scene.variantChoiceRenderable(set.prim, set.name, option);
              return (
                <ContextMenuItem
                  key={option}
                  disabled={!renderable}
                  title={
                    renderable
                      ? undefined
                      : available
                        ? 'Combinaison non cuite avec les variantes retenues — recomposer la scène'
                        : 'Option non cuite dans la conversion — recomposer la scène'
                  }
                  onSelect={() => scene.setVariant(set.prim, set.name, option)}
                >
                  {option}
                </ContextMenuItem>
              );
            })}
          </ContextMenuSubContent>
        </ContextMenuSub>
      ))}
      {sets.length > 0 && <ContextMenuSeparator />}
      {onFrame && (
        <ContextMenuItem onSelect={onFrame}>
          <Frame size={14} /> {t('review.frameView')}
        </ContextMenuItem>
      )}
      <ContextMenuItem onSelect={() => scene.setPrim(path, { visible: hidden ? undefined : false })}>
        {hidden ? 'Afficher' : 'Masquer'}
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => scene.isolate(path)}>Isoler</ContextMenuItem>
      <ContextMenuItem onSelect={() => scene.setPrim(path, null)}>{t('review.prim.reset')}</ContextMenuItem>
    </>
  );
}

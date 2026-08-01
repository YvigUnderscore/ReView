import { Frame } from 'lucide-react';
import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from '../../../components/ui/context-menu';
import type { UsdModelInfo } from '../../../types/api';
import { isHidden } from '../three/sceneOverride';
import { isSelfOrDescendant } from '../three/usdScenegraph';
import type { UsdSceneState } from '../three/useUsdScene';

/**
 * Actions d'un prim USD (46.E/46.M) — contenu **partagé** entre le clic droit d'une ligne du
 * scenegraph et le clic droit sur l'objet dans le viewer : variantes, visibilité, isolement,
 * réinitialisation. Un seul endroit décide de ce qu'on peut faire d'un prim.
 */
export default function PrimMenuItems({
  scene,
  usd,
  path,
  onFrame,
}: {
  scene: UsdSceneState;
  usd: UsdModelInfo | null;
  path: string;
  /** Cadrer la vue sur ce prim — proposé depuis le viewer, où la caméra est le contexte. */
  onFrame?: () => void;
}) {
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
            {set.options.map((option) => (
              <ContextMenuItem key={option} onSelect={() => scene.setVariant(set.prim, set.name, option)}>
                {option}
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
      ))}
      {sets.length > 0 && <ContextMenuSeparator />}
      {onFrame && (
        <ContextMenuItem onSelect={onFrame}>
          <Frame size={14} /> Cadrer la vue dessus
        </ContextMenuItem>
      )}
      <ContextMenuItem onSelect={() => scene.setPrim(path, { visible: hidden ? undefined : false })}>
        {hidden ? 'Afficher' : 'Masquer'}
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => scene.isolate(path)}>Isoler</ContextMenuItem>
      <ContextMenuItem onSelect={() => scene.setPrim(path, null)}>Réinitialiser ce prim</ContextMenuItem>
    </>
  );
}

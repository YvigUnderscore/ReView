// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Copy, Frame, Trash2 } from 'lucide-react';
import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from '@/v2/components/ui/context-menu';
import type { UsdBakedVariant, UsdModelInfo } from '@/v2/types/api';
import { isClonePath, isHidden } from '../three/sceneOverride';
import { isSelfOrDescendant } from '../three/usdScenegraph';
import { variantOptionAvailable } from '../three/variantAvailability';
import type { UsdSceneState } from '../three/useUsdScene';
import { useT } from '@/v2/i18n';

/**
 * Actions of a USD prim (46.E/46.M): content **shared** between the right-click on a scenegraph row
 * and the right-click on the object in the viewer: variants, visibility, isolation, reset. A single
 * place decides what can be done with a prim.
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
  /** Options actually baked into the GLB (46.P): the others are greyed out, not misleading. */
  baked?: readonly UsdBakedVariant[] | null;
  path: string;
  /** Frame the view on this prim: offered from the viewer, where the camera is the context. */
  onFrame?: () => void;
}) {
  const t = useT();

  // Staging clone (C1): its own actions: duplicate again, frame, delete. Like hide/isolate, it is a
  // local exploration: attached to a comment, or recorded for everyone by the manager before publication.
  if (isClonePath(path)) {
    return (
      <>
        <ContextMenuItem onSelect={() => scene.duplicatePrim(path)}>
          <Copy size={14} /> {t('prim.duplicate')}
        </ContextMenuItem>
        {onFrame && (
          <ContextMenuItem onSelect={onFrame}>
            <Frame size={14} /> {t('review.frameView')}
          </ContextMenuItem>
        )}
        <ContextMenuItem onSelect={() => scene.deleteClone(path)}>
          <Trash2 size={14} /> {t('common.delete')}
        </ContextMenuItem>
      </>
    );
  }

  // Variant sets of the prim **and of its ancestors**: one clicks a mesh, but the variant is held higher
  // up (`/World/Asset`). That is where it must be written to apply.
  const sets = (usd?.variantSets ?? []).filter((v) => isSelfOrDescendant(path, v.prim));
  const hidden = isHidden(scene.override, path);

  return (
    <>
      {sets.map((set) => (
        <ContextMenuSub key={`${set.prim}:${set.name}`}>
          <ContextMenuSubTrigger>{t('prim.variantNamed', { name: set.name })}</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {set.options.map((option) => {
              const available = variantOptionAvailable(baked, set.prim, set.name, option, set.selected);
              // Combination with the retained options of the prim's other sets: baking composes each
              // option with the defaults. Two non-default options together do not exist in the GLB:
              // choosing one would make the object disappear (46.U).
              const renderable = available && scene.variantChoiceRenderable(set.prim, set.name, option);
              return (
                <ContextMenuItem
                  key={option}
                  disabled={!renderable}
                  title={
                    renderable ? undefined : available ? t('prim.notBakedCombo') : t('prim.notBakedOption')
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
      <ContextMenuItem onSelect={() => scene.duplicatePrim(path)}>
        <Copy size={14} /> {t('prim.duplicate')}
      </ContextMenuItem>
      {/* Alignment/distribution (C2): on the current multi-selection, world boxes. */}
      {scene.selected.length >= 2 && scene.selected.includes(path) && (
        <ContextMenuSub>
          <ContextMenuSubTrigger>{t('prim.align')}</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {([0, 1, 2] as const).map((axis) => (
              <ContextMenuSub key={axis}>
                <ContextMenuSubTrigger>
                  <code>{'XYZ'[axis]}</code>
                </ContextMenuSubTrigger>
                <ContextMenuSubContent>
                  <ContextMenuItem onSelect={() => scene.alignSelected(axis, 'min')}>
                    {t('prim.align.min')}
                  </ContextMenuItem>
                  <ContextMenuItem onSelect={() => scene.alignSelected(axis, 'center')}>
                    {t('prim.align.center')}
                  </ContextMenuItem>
                  <ContextMenuItem onSelect={() => scene.alignSelected(axis, 'max')}>
                    {t('prim.align.max')}
                  </ContextMenuItem>
                  {scene.selected.length >= 3 && (
                    <ContextMenuItem onSelect={() => scene.distributeSelected(axis)}>
                      {t('prim.distribute')}
                    </ContextMenuItem>
                  )}
                </ContextMenuSubContent>
              </ContextMenuSub>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
      )}
      <ContextMenuItem onSelect={() => scene.setPrim(path, { visible: hidden ? undefined : false })}>
        {hidden ? t('common.show') : t('common.hide')}
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => scene.isolate(path)}>{t('prim.isolate')}</ContextMenuItem>
      <ContextMenuItem onSelect={() => scene.setPrim(path, null)}>{t('review.prim.reset')}</ContextMenuItem>
    </>
  );
}

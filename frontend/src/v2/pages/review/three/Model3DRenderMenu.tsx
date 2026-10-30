// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { SlidersHorizontal } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/v2/components/ui/popover';
import DisplayPanel from '../panels/DisplayPanel';
import type { Model3DInspectState } from './useModel3DInspect';
import type { Model3DVariantsState } from './useModel3DVariants';
import { useT } from '@/v2/i18n';

/**
 * 3D viewer render settings, **inside the viewer**: top-left corner, as a popover.
 *
 * They used to live in the "Display" tab of the dock: at the other end of the screen, behind a fold,
 * for toggles one tries in quick succession (shaded → wireframe → matcap → shaded) while looking at
 * the model. The tab has therefore disappeared; its content is here, in full: render mode,
 * material variant, embedded camera, rig skeleton, rendered by the **same** `DisplayPanel`, so that a
 * setting added tomorrow reaches both places or neither.
 *
 * The render-mode path is not duplicated: it is the `useModel3DInspect` state of the review component
 * that is plugged in here, the very one that applies the non-destructive override to the scene and
 * that a comment's camera view replays.
 */
export default function Model3DRenderMenu({
  inspect,
  variants,
}: {
  inspect: Model3DInspectState;
  variants: Model3DVariantsState;
}) {
  const t = useT();
  return (
    <Popover>
      <PopoverTrigger
        title={t('viewer.render.title')}
        aria-label={t('viewer.render.title')}
        className="flex items-center gap-1.5 rounded-md border border-border bg-card/85 px-2 py-1.5 text-xs font-medium text-muted-foreground shadow-lg backdrop-blur transition-colors hover:bg-card hover:text-foreground data-[state=open]:bg-card data-[state=open]:text-foreground"
      >
        <SlidersHorizontal size={13} />
        {t('viewer.render.title')}
      </PopoverTrigger>
      {/* Anchored to the left edge of the trigger: the popover drops along the viewer's edge
          rather than covering the centre of the frame, which is what one looks at. */}
      <PopoverContent align="start" className="flex w-60 flex-col gap-4 p-3">
        <DisplayPanel
          model={{
            mode: inspect.mode,
            onMode: inspect.setMode,
            variants: {
              names: variants.variants,
              active: variants.variants[variants.current] ?? null,
              onSelect: (name) => variants.selectVariant(variants.variants.indexOf(name)),
            },
            cameras: {
              names: variants.cameras.map((c) => c.name),
              active: null,
              onSelect: (name) => variants.goToCamera(variants.cameras.findIndex((c) => c.name === name)),
            },
            skeleton: {
              has: inspect.hasSkeleton,
              shown: inspect.showSkeleton,
              onShow: inspect.setShowSkeleton,
            },
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

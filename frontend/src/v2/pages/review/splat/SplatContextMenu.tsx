// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState, type ReactNode } from 'react';
import { Check, Copy, Frame, Grid3x3, Home, MapPin } from 'lucide-react';
import { toast } from 'sonner';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '../../../components/ui/context-menu';
import type { Hotspot3D } from '../reviewTypes';
import { copyImageToClipboard } from '../mediaCapture';
import { useSpatialContextMenu } from '../viewer/useSpatialContextMenu';
import type { SplatViewer } from './useSplat';
import { useT } from '../../../i18n';

/**
 * Right-click menu of the splat viewer (Phase 50, batch 8).
 *
 * The splat was the only screen of ReView without a context menu: its right-click belonged entirely to
 * flying around, and the documentation made it a rule ("nothing splat-related hides in a context menu").
 * Now that a **short** right-click is told apart from a **held** one (`viewer/useSpatialContextMenu`), the
 * place is free, and the right-click is where one looks for an action everywhere else in the application.
 *
 * Retained content, i.e. what one often does **here** and which used to cost a detour:
 *
 *  1. **Frame** and **Original view**: the two reframing gestures of the viewer. They exist as `F`/`H` and
 *     at the bottom of the rail, but it is with the mouse in hand that one wants them, at the moment one has
 *     got lost in the cloud.
 *  2. **Place a point of interest here**: the action **at the targeted point**, in one gesture, without
 *     arming the rail's tool (`I`). The point joins the same numbered list as those placed by clicking: one
 *     data path, two ways of designating.
 *  3. **Copy the view**: the capture of the current frame to the clipboard. The *Export* panel only produces
 *     files; "show what I see" in a message did not exist.
 *  4. **Scene** submenu: ground grid and edge culling, the two switches one handles while inspecting, the
 *     second of which became active by default (batch 8). Whoever sees splats fade out at strong zoom must be
 *     able to cut them where they notice the problem, without going to open the dock. The submenu takes the
 *     title of the dock panel: same vocabulary, same content, two paths.
 *
 * Nothing writes into the media: the cloud's editing has its mode, its tools and its publication lock, and a
 * context menu is not the place to get around them.
 */
export default function SplatContextMenu({
  splat,
  frameView,
  homeView,
  onPlacePoint,
  grid,
  culling,
  children,
}: {
  splat: SplatViewer;
  frameView: () => void;
  homeView: () => void;
  /** Point of interest placed at the targeted point: joins the comment being drafted. */
  onPlacePoint: (hotspot: Hotspot3D) => void;
  grid: { visible: boolean; toggle: () => void };
  culling: { off: boolean; onOff: (off: boolean) => void };
  children: ReactNode;
}) {
  const t = useT();
  // Right-click point: the entries that target a surface (the point of interest) need it,
  // and it is only known when the button is released.
  const [tap, setTap] = useState<{ x: number; y: number } | null>(null);
  useSpatialContextMenu(splat.getDom, splat.ready, (at) => {
    setTap({ x: at.clientX, y: at.clientY });
    return true; // the splat has nothing to target: its entries concern the view
  });

  const placePoint = () => {
    const hotspot = tap && splat.hotspotAtPointer(tap.x, tap.y);
    if (!hotspot) {
      toast.error(t('poi.noSurface'));
      return;
    }
    onPlacePoint(hotspot);
  };

  const copyView = () =>
    void splat
      .captureThumbnail()
      .then((dataUrl) => {
        // Capture impossible: the message must speak of the CAPTURE, not of an absent surface.
        if (!dataUrl) throw new Error(t('ctx.actionFailed', { action: t('ctx.copyImage') }));
        return copyImageToClipboard(dataUrl);
      })
      .then(() => toast.success(t('ctx.imageCopied')))
      .catch((e: unknown) =>
        toast.error(e instanceof Error ? e.message : t('ctx.actionFailed', { action: t('ctx.copyImage') })),
      );

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="contents">{children}</div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={frameView}>
          <Frame size={14} /> {t('action.fitSpatial')}
        </ContextMenuItem>
        <ContextMenuItem onSelect={homeView}>
          <Home size={14} /> {t('action.resetSpatial')}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={placePoint}>
          <MapPin size={14} /> {t('ctx.splatPointHere')}
        </ContextMenuItem>
        <ContextMenuItem onSelect={copyView}>
          <Copy size={14} /> {t('ctx.splatCopyView')}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <Grid3x3 size={14} /> {t('panel.scene')}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuItem onClick={grid.toggle}>
              <Check size={14} className={grid.visible ? 'opacity-100' : 'opacity-0'} />
              {t('viewer.guides.grid')}
            </ContextMenuItem>
            {/* The dock's switch ticks "culling active": we keep the same meaning here, so the tick follows
                `!off`. Two paths for one setting, never two readings. */}
            <ContextMenuItem onClick={() => culling.onOff(!culling.off)}>
              <Check size={14} className={culling.off ? 'opacity-0' : 'opacity-100'} />
              {t('viewer.culling.short')}
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
      </ContextMenuContent>
    </ContextMenu>
  );
}

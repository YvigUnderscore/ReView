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
 * Menu clic droit du viewer splat (Phase 50, lot 8).
 *
 * Le splat était le seul écran de ReView sans menu contextuel : son clic droit appartenait
 * entièrement au vol, et la documentation en faisait une règle (« nothing splat-related hides in
 * a context menu »). Depuis que le clic droit **bref** se distingue du clic droit **maintenu**
 * (`viewer/useSpatialContextMenu`), la place est libre — et le clic droit est l'endroit où l'on
 * cherche une action partout ailleurs dans l'application.
 *
 * Contenu retenu — ce qu'on fait souvent **ici**, et qui coûtait un détour :
 *
 *  1. **Cadrer** et **Vue d'origine** : les deux gestes de recadrage du viewer. Ils existent en
 *     `F`/`H` et au bas du rail, mais c'est la main sur la souris qu'on les veut, au moment où
 *     l'on s'est perdu dans le nuage.
 *  2. **Poser un point d'intérêt ici** : l'action **au point visé**. L'outil du rail demande de
 *     l'armer (`I`) *puis* de cliquer ; ici le point désigné est celui du clic droit, en un geste.
 *  3. **Copier la vue** : la capture du cadre courant dans le presse-papiers. Le panneau *Export*
 *     ne produit que des fichiers ; « montrer ce que je vois » dans un message n'existait pas.
 *  4. Sous-menu **Scène** : grille de sol et culling de bord — les deux interrupteurs qu'on
 *     manipule en inspectant, et dont le second est devenu actif par défaut (lot 8). Qui voit des
 *     splats s'évanouir en zoom fort doit pouvoir le couper là où il constate le problème, sans
 *     aller ouvrir le dock. Le sous-menu reprend le titre du panneau du dock : même vocabulaire,
 *     même contenu, deux chemins.
 *
 * Rien qui écrive dans le média : l'édition du nuage a son mode, ses outils et son verrou de
 * publication — un menu contextuel n'est pas l'endroit pour les contourner.
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
  /** Point d'intérêt posé au point visé — rejoint le commentaire en cours de rédaction. */
  onPlacePoint: (hotspot: Hotspot3D) => void;
  grid: { visible: boolean; toggle: () => void };
  culling: { off: boolean; onOff: (off: boolean) => void };
  children: ReactNode;
}) {
  const t = useT();
  // Point du clic droit : les entrées qui visent une surface (le point d'intérêt) en ont besoin,
  // et il n'est connu qu'au relâchement du bouton.
  const [tap, setTap] = useState<{ x: number; y: number } | null>(null);
  useSpatialContextMenu(splat.getDom, splat.ready, (at) => {
    setTap({ x: at.clientX, y: at.clientY });
    return true; // le splat n'a rien à viser : ses entrées portent sur la vue
  });

  const placePoint = () => {
    const hotspot = tap && splat.hotspotAtPointer(tap.x, tap.y);
    if (!hotspot) {
      toast.error(t('ctx.splatNoSurface'));
      return;
    }
    onPlacePoint(hotspot);
  };

  const copyView = () =>
    void splat
      .captureThumbnail()
      .then((dataUrl) => {
        if (!dataUrl) throw new Error(t('ctx.splatNoSurface'));
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
            {/* L'interrupteur du dock coche « culling actif » : on garde le même sens ici, donc
                la coche suit `!off` — deux chemins pour un réglage, jamais deux lectures. */}
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

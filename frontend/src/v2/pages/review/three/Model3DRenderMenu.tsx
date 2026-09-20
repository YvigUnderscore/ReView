// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { SlidersHorizontal } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '../../../components/ui/popover';
import DisplayPanel from '../panels/DisplayPanel';
import type { Model3DInspectState } from './useModel3DInspect';
import type { Model3DVariantsState } from './useModel3DVariants';
import { useT } from '../../../i18n';

/**
 * Réglages de rendu du viewer 3D, **dans le viewer** — coin haut-gauche, en popover.
 *
 * Ils vivaient dans l'onglet « Affichage » du dock : à l'autre bout de l'écran, derrière un
 * repli, pour des bascules qu'on essaie en rafale (shaded → wireframe → matcap → shaded) en
 * regardant le modèle. L'onglet a donc disparu ; son contenu est ici, entier — mode de rendu,
 * variante de matériaux, caméra embarquée, squelette du rig — et rendu par le **même**
 * `DisplayPanel`, pour qu'un réglage ajouté demain arrive aux deux endroits ou à aucun.
 *
 * Le chemin du mode de rendu n'est pas doublé : c'est l'état `useModel3DInspect` du composant
 * de review qui est branché ici, celui-là même qui applique l'override non destructif à la
 * scène et que la vue caméra d'un commentaire rejoue.
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
      {/* Ancré au bord gauche du déclencheur : le popover descend le long du bord du viewer
          plutôt que de recouvrir le centre du cadre, qui est ce qu'on regarde. */}
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

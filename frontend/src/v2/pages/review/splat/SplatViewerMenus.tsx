// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { SlidersHorizontal } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '../../../components/ui/popover';
import DisplayPanel from '../panels/DisplayPanel';
import type { SplatCompareState } from './compare/useSplatCompare';
import type { SplatEditorState } from './editor/useSplatEditor';
import type { PresentationState } from './presentation/usePresentation';
import { useT } from '../../../i18n';

/**
 * Menu du viewer splat, **dans le viewer** — coin haut-gauche, en popover, exactement comme les
 * réglages de rendu du modèle 3D (`three/Model3DRenderMenu`, lot 6).
 *
 * Il n'en reste qu'un, **Rendu** : le **même** `DisplayPanel` que servait l'onglet « Affichage »
 * du dock, entier (mode de rendu du nuage, orientation, échelle brute de la comparaison, teinte
 * d'inspection). L'onglet a disparu ; un réglage ajouté demain arrive donc aux deux viewers
 * spatiaux ou à aucun.
 *
 * Le popover « Édition » du lot 12 a été RETIRÉ au lot 13. Il portait les outils du mode
 * « Nettoyer » et l'interrupteur qui y entrait — or ranger des outils derrière un clic n'était
 * pas la demande : c'était retirer le SEGMENT de l'en-tête. Les outils sont donc revenus au rail,
 * dans un second groupe permanent (`splatChrome.splatEditRail`), où ils sont directement
 * cliquables ; cliquer l'un d'eux arme le mode, et le premier groupe du rail — celui du mode par
 * défaut — en est la sortie. Le popover ne gardait aucun réglage propre : tout ce qui en était un
 * (rendu du nuage, orientation) est ici, tout ce qui était un outil est au rail.
 *
 * Le composant est monté par le **slot `settings` du pane**, hors de `ReviewFrame` : le guide
 * letterbox et les coordonnées normalisées des annotations ne bougent pas, et le popover descend
 * le long du bord gauche plutôt que de recouvrir le centre du cadre, qui est ce qu'on regarde.
 */

/**
 * Habillage du déclencheur — identique à celui posé au lot 6 par `Model3DRenderMenu` : c'est
 * la même commande, au même coin, dans les deux viewers spatiaux. Le jour où un troisième
 * viewer en veut une, cette chaîne monte dans `chrome.css` et les deux menus l'y lisent.
 */
const TRIGGER =
  'flex items-center gap-1.5 rounded-md border border-border bg-card/85 px-2 py-1.5 text-xs font-medium text-muted-foreground shadow-lg backdrop-blur transition-colors hover:bg-card hover:text-foreground data-[state=open]:bg-card data-[state=open]:text-foreground';

export default function SplatViewerMenus({
  editor,
  showEdit,
  pres,
  compare,
}: {
  editor: SplatEditorState;
  /** Éditeur monté (média éditable + gestionnaire) : mode de rendu et orientation en dépendent. */
  showEdit: boolean;
  /** Teinte d'inspection — réglage de session, offert à tout le monde. */
  pres: Pick<PresentationState, 'debugMode' | 'setDebugMode'>;
  /** Comparaison A/B : porte l'échelle brute des nuages comparés. */
  compare?: SplatCompareState;
}) {
  const t = useT();

  return (
    <div className="flex items-center gap-1.5">
      <Popover>
        <PopoverTrigger
          title={t('viewer.render.title')}
          aria-label={t('viewer.render.title')}
          className={TRIGGER}
        >
          <SlidersHorizontal size={13} />
          {t('viewer.render.title')}
        </PopoverTrigger>
        <PopoverContent align="start" className="flex w-60 flex-col gap-4 p-3">
          <DisplayPanel
            // Le mode de rendu et l'orientation sont des éditions : réservés à l'éditeur monté.
            splat={
              showEdit
                ? {
                    mode: editor.renderMode,
                    onMode: editor.setRenderMode,
                    baseFlip: editor.baseFlip,
                    onBaseFlip: () => editor.toggleBaseFlip(),
                  }
                : undefined
            }
            realSize={
              compare?.enabled
                ? { value: !compare.normalized, onChange: compare.toggleNormalized }
                : undefined
            }
            debugMode={pres.debugMode}
            onDebugMode={pres.setDebugMode}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

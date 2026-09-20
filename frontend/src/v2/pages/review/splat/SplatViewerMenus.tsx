// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { Scissors, SlidersHorizontal } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '../../../components/ui/popover';
import { Switch } from '../../../components/ui/switch';
import { Group, Row } from '../chrome/DockGroup';
import { RailButton } from '../chrome/ToolRail';
import DisplayPanel from '../panels/DisplayPanel';
import type { ChromeState } from '../chrome/chromeState';
import { DEFAULT_MODE } from '../chrome/modes';
import type { SplatCompareState } from './compare/useSplatCompare';
import type { SplatEditorState } from './editor/useSplatEditor';
import type { PresentationState } from './presentation/usePresentation';
import { splatEditTools } from './splatChrome';
import { useT } from '../../../i18n';

/**
 * Menus du viewer splat, **dans le viewer** — coin haut-gauche, en popovers, exactement comme
 * les réglages de rendu du modèle 3D (`three/Model3DRenderMenu`, lot 6). Deux menus :
 *
 *  - **Édition** : l'interrupteur du mode « Nettoyer » et ses outils. Le segment « Nettoyer »
 *    a quitté l'en-tête (cf. `splatChrome`) ; ses outils sont ici, en `RailButton` — les mêmes
 *    boutons que le rail, pas des copies — et chacun arme le couple mode + outil que la lettre
 *    du clavier arme déjà. Armer ferme le menu : on trace juste après, sur le nuage.
 *  - **Rendu** : le **même** `DisplayPanel` que servait l'onglet « Affichage » du dock, entier
 *    (mode de rendu du nuage, orientation, échelle brute de la comparaison, teinte
 *    d'inspection). L'onglet a disparu ; un réglage ajouté demain arrive donc aux deux viewers
 *    spatiaux ou à aucun.
 *
 * Le composant est monté par le **slot `settings` du pane**, hors de `ReviewFrame` : le guide
 * letterbox et les coordonnées normalisées des annotations ne bougent pas, et les popovers
 * descendent le long du bord gauche plutôt que de recouvrir le centre du cadre, qui est ce
 * qu'on regarde.
 */

/**
 * Habillage du déclencheur — identique à celui posé au lot 6 par `Model3DRenderMenu` : c'est
 * la même commande, au même coin, dans les deux viewers spatiaux. Le jour où un troisième
 * viewer en veut une, cette chaîne monte dans `chrome.css` et les deux menus l'y lisent.
 */
const TRIGGER =
  'flex items-center gap-1.5 rounded-md border border-border bg-card/85 px-2 py-1.5 text-xs font-medium text-muted-foreground shadow-lg backdrop-blur transition-colors hover:bg-card hover:text-foreground data-[state=open]:bg-card data-[state=open]:text-foreground';

export default function SplatViewerMenus({
  state,
  onState,
  editor,
  showEdit,
  pres,
  compare,
}: {
  /** Mode et outil courants : l'édition du nuage est le mode « Nettoyer » du chrome. */
  state: ChromeState;
  onState: (patch: Partial<ChromeState>) => void;
  editor: SplatEditorState;
  /** Éditeur monté (média éditable + gestionnaire) : sans lui, pas de menu d'édition. */
  showEdit: boolean;
  /** Teinte d'inspection — réglage de session, offert à tout le monde. */
  pres: Pick<PresentationState, 'debugMode' | 'setDebugMode'>;
  /** Comparaison A/B : porte l'échelle brute des nuages comparés. */
  compare?: SplatCompareState;
}) {
  const t = useT();
  const [editOpen, setEditOpen] = useState(false);
  const editing = state.mode === 'clean';

  return (
    <div className="flex items-center gap-1.5">
      {showEdit && (
        <Popover open={editOpen} onOpenChange={setEditOpen}>
          <PopoverTrigger
            title={t('viewer.edit.hint')}
            aria-label={t('viewer.edit.title')}
            className={TRIGGER}
          >
            <Scissors size={13} />
            {t('viewer.edit.title')}
          </PopoverTrigger>
          <PopoverContent align="start" className="flex w-60 flex-col gap-4 p-3">
            {/* L'interrupteur est la seule sortie à la souris : sans lui, entrer en édition par
                un outil laisserait le viewer dans un mode qu'aucun segment ne quitte plus. */}
            <Row label={t('viewer.edit.title')} hint={t('viewer.edit.hint')}>
              <Switch
                checked={editing}
                onCheckedChange={(v) => onState({ mode: v ? 'clean' : DEFAULT_MODE })}
                label={t('viewer.edit.hint')}
              />
            </Row>
            <Group title={t('rail.tools')}>
              <div className="rv-menulist">
                {splatEditTools().map((tool) => (
                  <RailButton
                    key={tool.id}
                    icon={tool.icon}
                    label={t(tool.labelKey)}
                    shortcut={tool.key}
                    hint={t(tool.hintKey)}
                    active={editing && state.tool === tool.id}
                    labels
                    onClick={() => {
                      onState({ mode: 'clean', tool: tool.id });
                      setEditOpen(false);
                    }}
                  />
                ))}
              </div>
            </Group>
          </PopoverContent>
        </Popover>
      )}

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

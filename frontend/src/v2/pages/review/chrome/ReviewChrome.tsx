// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReactNode } from 'react';
import type { MediaKind, Role } from '../../../types/api';
import { Badge } from '../../../components/ui/badge';
import { ErrorBoundary } from '../../../components/ui/error-boundary';
import { SegmentedControl } from '../../../components/ui/segmented-control';
import ToolRail from './ToolRail';
import InspectorDock from './InspectorDock';
import { useReviewHeaderSlots } from '../header/reviewHeaderSlots';
import { DEFAULT_MODE, canSwitchMode, switcherModesFor, type ModeId, type ReviewMode } from './modes';
import { panelsFor, type PanelId } from './panels';
import {
  toolsFor,
  viewActionsFor,
  type RailSection,
  type ReviewTool,
  type ToolId,
  type ViewAction,
} from './tools';
import type { ChromeState } from './chromeState';
import './chrome.css';
import { useT } from '../../../i18n';

/**
 * Conteneur du chrome de review : les cinq emplacements fixes, identiques pour les quatre
 * types de média. Bascule de mode en haut, rail d'outils à gauche, barre d'options sous
 * l'en-tête, dock inspecteur à droite, temps ou zoom en bas.
 *
 * Le média ne garde que les surcouches ancrées à la vue (tracés, épingles, barre de wipe,
 * repères, PiP, triade d'axes, compteur) : plus aucun réglage ne recouvre l'image jugée.
 */
export default function ReviewChrome({
  kind,
  state,
  onState,
  role,
  modes: modesProp,
  tools: toolsProp,
  railExtra,
  headerLeft,
  headerRight,
  options,
  panel,
  transport,
  drawer,
  comments,
  onViewAction,
  dirty,
  children,
}: {
  kind: MediaKind;
  state: ChromeState;
  onState: (patch: Partial<ChromeState>) => void;
  role: Role;
  /**
   * Modes proposés par la bascule. Par défaut ceux du type de média ; le montage n'en a
   * qu'un (regarder), la comparaison A/B n'ayant pas de sens sur un film
   * assemblé. En dessous de deux, la bascule disparaît plutôt que de montrer un segment
   * unique qui ne bascule vers rien.
   */
  modes?: ReviewMode[];
  /**
   * Outils du rail. Par défaut ceux du mode et du type de média ; le montage fournit les
   * siens, dont un outil de navigation qui ne promet ni panoramique ni zoom — il n'en a pas.
   */
  tools?: ReviewTool[];
  /**
   * Groupe d'outils supplémentaire, sous celui du mode courant : le rail d'un mode **valide mais
   * absent de la bascule**. C'est par là que l'édition du nuage revient au rail (Phase 50, lot
   * 13) — le segment « Nettoyer » a quitté l'en-tête, ses outils ne devaient pas quitter la
   * gauche de l'écran pour autant.
   *
   * Tant que ce mode est le mode courant, le premier groupe montre celui du mode par défaut :
   * le rail garde la même forme d'un bout à l'autre, et cliquer un de ses outils est la sortie
   * du mode — sans quoi l'on s'y enfermerait, la bascule n'ayant plus de segment à rendre.
   */
  railExtra?: RailSection;
  /**
   * Média, version, navigation — à gauche de l'en-tête. La review les fournit par contexte
   * (`ReviewHeaderSlots`) ; cette prop sert au lecteur de montage, qui n'a pas ce contexte.
   */
  headerLeft?: ReactNode;
  /**
   * A/B du viewer — à droite de l'en-tête, devant les actions de la page. C'est là que la 3D
   * et le splat posent leur sélecteur de versions, alimenté par leur propre hook.
   */
  headerRight?: ReactNode;
  /** `<OptionsBar>` de l'outil actif. */
  options: ReactNode;
  /** Contenu du panneau ouvert. */
  panel: ReactNode;
  transport?: ReactNode;
  /** Tiroir ancré sous le transport (courbes ou pellicule). */
  drawer?: ReactNode;
  /** Dernière colonne. La review la fournit par contexte ; cette prop la force. */
  comments?: ReactNode;
  /**
   * Cadrer / vue d'origine. Absent quand le viewer ne les implémente pas : le rail n'affiche
   * alors pas ces deux boutons plutôt que d'en proposer d'inertes.
   */
  onViewAction?: (action: ViewAction['id']) => void;
  /** Éditions en attente — vient des hooks d'édition, pas de l'état du chrome. */
  dirty?: boolean;
  /** Le viewport, plein espace. */
  children: ReactNode;
}) {
  const t = useT();
  // En-tête unique : la page de review pose identité, actions et commentaires ici plutôt que
  // dans une barre à elle. Hors review (lecteur de montage), le contexte est absent et seules
  // les props comptent.
  const slots = useReviewHeaderSlots();
  const left = headerLeft ?? slots?.identity;
  // Les deux cohabitent sans se chasser : l'A/B du viewer d'abord, les actions de la page
  // ensuite — c'est le seul endroit où les deux moitiés de l'ancien en-tête se rejoignent.
  const hasRight = Boolean(headerRight) || Boolean(slots?.actions);
  const commentsColumn = comments ?? slots?.comments;
  // La bascule ne liste pas « Annoter » : l'annotation s'arme depuis l'espace commentaire.
  // Le mode reste valide — pendant l'annotation, aucun segment n'est actif et c'est le bouton
  // du composer qui joue l'indicateur ; le pied de page garde le bon rappel.
  const modes = modesProp ?? switcherModesFor(kind);
  // Plus de liste d'outils « masqués » (Phase 50) : elle ne filtrait que le rail, et la lettre
  // armait quand même l'outil retiré. Un outil qu'un viewer n'implémente pas n'existe plus du
  // tout — soit il porte son type de média (`kind`), soit il a été supprimé de `tools.ts`.
  //
  // Mode du PREMIER groupe : celui du chrome, sauf quand c'est le mode du groupe supplémentaire
  // — on montre alors celui du mode par défaut, qui est la sortie.
  const mainMode = railExtra?.mode === state.mode ? DEFAULT_MODE : state.mode;
  const tools = toolsProp ?? toolsFor(mainMode, kind);
  const sections: RailSection[] = [
    { mode: mainMode, titleKey: 'rail.tools', tools },
    ...(railExtra && railExtra.tools.length > 0 ? [railExtra] : []),
  ];
  const panels = panelsFor(kind);
  // Le client ne voit pas la bascule : il reste dans le mode d'exploration, en lecture seule.
  const switchable = canSwitchMode(role, modes.length);

  return (
    <div
      // La largeur minimale de 1440 px rendait la review inutilisable sur un portable :
      // sous ce seuil, toute la page partait en défilement horizontal (D1). Le rail et le
      // dock se replient désormais d'eux-mêmes, la barre d'en-tête passe à la ligne.
      className="flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground"
    >
      {/* En-tête unique : identité à gauche, bascule de mode au centre, A/B du viewer puis
          actions de la page à droite. Il passe à la ligne plutôt que de déborder — la barre
          fusionnée est bien plus chargée que la seule bascule qu'elle portait. */}
      <header className="flex flex-shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-card px-3 py-2">
        {left && <div className="flex min-w-0 flex-shrink items-center gap-2">{left}</div>}
        {switchable && (
          <div className="mx-auto flex items-center gap-2">
            <SegmentedControl
              size="lg"
              label={t('review.mode')}
              // Plus aucun mode n'est fermé par la publication : le dernier — la découpe
              // vidéo — a été retiré en Phase 50. Un mode grisé n'existe donc plus.
              items={modes.map((m, index) => ({
                value: m.value,
                label: t(m.labelKey),
                icon: m.icon,
                hint: `${t(m.labelKey)} (${index + 1}) — ${t(m.hintKey)}`,
              }))}
              value={state.mode}
              onChange={(mode: ModeId) => onState({ mode })}
            />
          </div>
        )}
        {hasRight && (
          <div className={`flex flex-shrink-0 items-center gap-2 text-sm${switchable ? '' : ' ml-auto'}`}>
            {headerRight}
            {slots?.actions}
          </div>
        )}
      </header>

      <div className="flex min-h-0 flex-1">
        <ToolRail
          sections={sections}
          actions={onViewAction ? viewActionsFor(kind) : []}
          mode={state.mode}
          tool={state.tool}
          onTool={(tool: ToolId, mode: ModeId) => onState({ tool, mode })}
          onAction={(action) => onViewAction?.(action)}
          labels={state.labels}
          onLabels={() => onState({ labels: !state.labels })}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          {options}
          {/* Le viewport monte Three.js, Spark ou hls.js. Depuis que les commentaires sont
              une colonne du chrome, un plantage WebGL les emporterait : la frontière descend
              donc au ras du viewer, et l'en-tête, le dock et le fil de commentaires
              survivent à la vue qui tombe. */}
          <ErrorBoundary scope="viewer">{children}</ErrorBoundary>
          {transport}
          {drawer}
        </div>

        <InspectorDock
          panels={panels}
          panel={state.panel}
          onPanel={(next: PanelId | null) => onState({ panel: next })}
        >
          {panel}
        </InspectorDock>

        {commentsColumn}
      </div>

      {/* Le pied de page ne dit plus que ce qui a une CONSÉQUENCE : reste-t-il quelque chose
          à enregistrer. Il narrait auparavant le mode actif et l'état du rail et du dock —
          des phrases que le lecteur a sous les yeux, et qui occupaient une bande en
          permanence pour ne rien lui apprendre. Le mode reste expliqué dans l'infobulle de
          son bouton, où l'on va le chercher quand on se pose la question. */}
      {dirty !== undefined && (
        <footer className="flex flex-shrink-0 items-center justify-end border-t border-border bg-card/60 px-2.5 py-[0.3125rem]">
          <Badge variant={dirty ? 'warning' : 'success'}>
            {dirty ? t('common.notSaved') : t('common.saved')}
          </Badge>
        </footer>
      )}
    </div>
  );
}

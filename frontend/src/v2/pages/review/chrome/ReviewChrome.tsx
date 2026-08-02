// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReactNode } from 'react';
import type { MediaKind, Role } from '../../../types/api';
import { Badge } from '../../../components/ui/badge';
import { SegmentedControl } from '../../../components/ui/segmented-control';
import ToolRail from './ToolRail';
import InspectorDock from './InspectorDock';
import { modesFor, switcherModesFor, type ModeId } from './modes';
import { panelsFor, type PanelId } from './panels';
import { toolsFor, viewActionsFor, type ToolId, type ViewAction } from './tools';
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
  headerLeft,
  headerRight,
  options,
  panel,
  transport,
  drawer,
  comments,
  onViewAction,
  dirty,
  hiddenTools,
  children,
}: {
  kind: MediaKind;
  state: ChromeState;
  onState: (patch: Partial<ChromeState>) => void;
  role: Role;
  /**
   * Média, version, navigation — à gauche de l'en-tête. Absent tant que la page de review
   * porte encore son propre en-tête : la barre du haut ne montre alors que la bascule de mode.
   */
  headerLeft?: ReactNode;
  /** A/B, présence, actions — à droite de l'en-tête. */
  headerRight?: ReactNode;
  /** `<OptionsBar>` de l'outil actif. */
  options: ReactNode;
  /** Contenu du panneau ouvert. */
  panel: ReactNode;
  transport?: ReactNode;
  /** Tiroir ancré sous le transport (courbes ou pellicule). */
  drawer?: ReactNode;
  comments?: ReactNode;
  /**
   * Cadrer / vue d'origine. Absent quand le viewer ne les implémente pas : le rail n'affiche
   * alors pas ces deux boutons plutôt que d'en proposer d'inertes.
   */
  onViewAction?: (action: ViewAction['id']) => void;
  /** Éditions en attente — vient des hooks d'édition, pas de l'état du chrome. */
  dirty?: boolean;
  /** Outils du mode que ce viewer n'implémente pas — retirés du rail. */
  hiddenTools?: ToolId[];
  /** Le viewport, plein espace. */
  children: ReactNode;
}) {
  const t = useT();
  // La bascule ne liste pas « Annoter » : l'annotation s'arme depuis l'espace commentaire.
  // Le mode reste valide — pendant l'annotation, aucun segment n'est actif et c'est le bouton
  // du composer qui joue l'indicateur ; le pied de page garde le bon rappel.
  const modes = switcherModesFor(kind);
  // Un viewer retire du rail les outils qu'il n'implémente pas : mieux vaut un rail court
  // qu'un bouton qui ne fait rien.
  const tools = toolsFor(state.mode, kind).filter((t) => !hiddenTools?.includes(t.id));
  const panels = panelsFor(kind);
  const activeMode = modesFor(kind).find((m) => m.value === state.mode) ?? modes[0]!;
  // Le client ne voit pas la bascule : il reste dans le mode d'exploration, en lecture seule.
  const canSwitchMode = role !== 'CLIENT';

  return (
    <div
      className={`flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground${
        // Largeur minimale du workspace — seulement quand le chrome tient toute la page.
        headerLeft ? ' min-w-[1440px]' : ''
      }`}
    >
      <header className="flex flex-shrink-0 flex-nowrap items-center gap-3 border-b border-border bg-card px-3 py-2">
        {headerLeft && <span className="flex min-w-0 flex-shrink-0 items-center gap-2">{headerLeft}</span>}
        {canSwitchMode && (
          <span className="mx-auto flex items-center gap-2">
            <SegmentedControl
              size="lg"
              label={t('review.mode')}
              items={modes.map((m) => ({
                value: m.value,
                label: m.label,
                icon: m.icon,
                hint: `${m.label} (${modes.indexOf(m) + 1}) — ${m.hint}`,
              }))}
              value={state.mode}
              onChange={(mode: ModeId) => onState({ mode })}
            />
          </span>
        )}
        {headerRight && (
          <span className={`flex flex-shrink-0 items-center gap-2${canSwitchMode ? '' : ' ml-auto'}`}>
            {headerRight}
          </span>
        )}
      </header>

      <div className="flex min-h-0 flex-1">
        <ToolRail
          tools={tools}
          actions={onViewAction ? viewActionsFor(kind) : []}
          tool={state.tool}
          onTool={(tool: ToolId) => onState({ tool })}
          onAction={(action) => onViewAction?.(action)}
          labels={state.labels}
          onLabels={() => onState({ labels: !state.labels })}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          {options}
          {children}
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

        {comments}
      </div>

      <footer className="flex flex-shrink-0 items-center gap-2.5 border-t border-border bg-card/60 px-2.5 py-[0.3125rem] text-[0.625rem] text-muted-foreground">
        <span>{activeMode.hint}</span>
        <span className="ml-auto flex items-center gap-2">
          <span>
            {state.labels ? 'Libellés visibles' : 'Rail en icônes'} · dock {state.panel ? 'ouvert' : 'replié'}
          </span>
          {dirty !== undefined && (
            <Badge variant={dirty ? 'warning' : 'success'}>{dirty ? 'Non enregistré' : 'Enregistré'}</Badge>
          )}
        </span>
      </footer>
    </div>
  );
}

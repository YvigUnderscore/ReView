// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { CircleDashed, Tag } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/apiClient';
import { qk } from './query';
import { usePipelineStatuses } from './shotgridApi';
import { useUndoToast } from './useUndoToast';
import { useT } from '../i18n';
import type { MenuEntry } from './menuSpec';
import type { TaskStatus } from '../types/api';
import {
  NO_STATUS,
  bodyForChoice,
  currentStatusValue,
  statusChoices,
  type StatusChoice,
  type StatusScope,
} from './statusMenu';

/**
 * Sous-menu « Statut » pour n'importe quel menu contextuel.
 *
 * Poser un statut demandait d'ouvrir la fiche de l'entité puis son panneau de réglages :
 * le geste le plus fréquent de la production était le plus long. Il tient maintenant en
 * un clic droit, sur une carte de plan, une ligne de séquence, une carte de kanban ou
 * une page d'entité — même vocabulaire partout, puisqu'il vient du référentiel du projet.
 *
 * Les trois périmètres partagent une seule route (`PATCH /api/{scope}s/:id`), qui valide
 * l'appartenance du statut au projet et se charge de l'envoi vers ShotGrid.
 */

const ENDPOINT: Record<StatusScope, string> = {
  task: '/api/tasks',
  shot: '/api/shots',
  sequence: '/api/sequences',
  asset: '/api/assets',
};

/** Ce qu'un appelant peut ajouter à l'écriture — au-delà du statut lui-même. */
export interface ApplyStatusOptions {
  /** Écriture optimiste dans le cache de l'appelant ; rend le rollback. */
  onOptimistic?: (choice: StatusChoice | null) => () => void;
  /**
   * Valeur d'AVANT. Connue, elle fait apparaître « Annuler » dans le toast de confirmation.
   *
   * C'est un cran, jamais un historique : changer un statut part au serveur et peut être
   * arbitré par ShotGrid derrière. Ctrl+Z laisserait croire à une pile locale qu'on ne tient
   * pas ; le toast, lui, ne promet que le coup qu'on vient de faire, et disparaît avec lui.
   */
  undoTo?: string;
  /** Rafraîchissement propre à l'appelant (la grille pagine par curseur : aucun cache partagé). */
  after?: () => Promise<unknown>;
}

export function useStatusMenu(projectId: number, scope: StatusScope) {
  const t = useT();
  const qc = useQueryClient();
  const { done } = useUndoToast();
  const { data: statuses = [] } = usePipelineStatuses(scope, projectId);
  const choices = statusChoices(statuses, scope, t);

  /**
   * L'écriture nue : optimiste, et qui **laisse remonter** son échec.
   *
   * Séparée d'`apply` parce que l'annulation la rejoue : un échec d'annulation doit parvenir
   * au toast qui l'a proposée, pas se transformer en un second message de succès.
   */
  const write = async (id: number, value: string, options: ApplyStatusOptions): Promise<void> => {
    const body = bodyForChoice(choices, value);
    if (!body) return;
    const choice = choices.find((c) => c.value === value) ?? null;
    const rollback = options.onOptimistic?.(choice);
    try {
      await api.patch(`${ENDPOINT[scope]}/${id}`, body);
    } catch (err) {
      rollback?.();
      throw err;
    } finally {
      // Le serveur fait foi : il a pu déduire un `status` de famille différente, ou
      // refuser au profit d'un arbitrage ShotGrid.
      void qc.invalidateQueries({ queryKey: qk.projectBoard(projectId) });
      if (scope === 'task') void qc.invalidateQueries({ queryKey: qk.task(id) });
      if (scope === 'shot') {
        void qc.invalidateQueries({ queryKey: qk.shot(id) });
        void qc.invalidateQueries({ queryKey: ['shots', projectId] });
      }
      if (scope === 'sequence') {
        void qc.invalidateQueries({ queryKey: qk.sequence(id) });
        void qc.invalidateQueries({ queryKey: qk.sequences(projectId) });
      }
      await options.after?.();
    }
  };

  /**
   * Applique le choix, en montrant le résultat avant la réponse du serveur, puis en confirmant
   * — avec « Annuler » quand la valeur d'avant est connue (`undoTo`).
   *
   * `onOptimistic` est fourni par l'appelant : les caches n'ont pas tous la même forme
   * (la page de plan garde le payload `{ shot }`, la liste garde un tableau), et une
   * écriture « au jugé » casserait l'un ou l'autre en silence.
   */
  const apply = async (id: number, value: string, options: ApplyStatusOptions = {}) => {
    const choice = choices.find((c) => c.value === value) ?? null;
    try {
      await write(id, value, options);
      const message =
        value === NO_STATUS
          ? t('pipeline.status.cleared')
          : t('pipeline.status.set', { name: choice?.label ?? '' });
      const { undoTo } = options;
      done(
        message,
        undoTo === undefined
          ? undefined
          : () => write(id, undoTo, { onOptimistic: options.onOptimistic, after: options.after }),
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('pipeline.status.changeFailed'));
    }
  };

  /**
   * L'entrée de menu. `allowClear` est faux quand le projet est relié à ShotGrid : le
   * site ne sait pas recevoir un statut vide, et la synchronisation suivante ramènerait
   * l'ancienne valeur — proposer le geste reviendrait à promettre ce qu'on ne tient pas.
   */
  const entry = (
    entity: StatusTarget,
    options: {
      canEdit?: boolean;
      allowClear?: boolean;
      onOptimistic?: (choice: StatusChoice | null) => () => void;
    } = {},
  ): MenuEntry | null => {
    if (options.canEdit === false || choices.length === 0) return null;
    const value = currentStatusValue(choices, entity);
    const items = [
      ...choices.map((choice) => ({
        id: `status-${choice.value}`,
        value: choice.value,
        label: choice.label,
        icon: statusDot(choice.color),
      })),
      ...(options.allowClear === false
        ? []
        : [
            {
              id: 'status-none',
              value: NO_STATUS,
              label: t('pipeline.status.none'),
              icon: <CircleDashed size={13} className="text-muted-foreground" />,
            },
          ]),
    ];
    return {
      kind: 'submenu',
      id: 'status',
      label: t('pipeline.status.menu'),
      icon: <Tag size={14} />,
      items: [
        {
          kind: 'radiogroup',
          id: 'status-group',
          value,
          // Radix rappelle le gestionnaire même quand on re-clique l'item déjà coché :
          // sans cette sortie, chaque ouverture suivie d'un clic repartirait vers ShotGrid.
          onValueChange: (next) => {
            if (next === value) return;
            // `value` est l'état d'avant, lu au moment où le menu s'est ouvert : c'est
            // exactement ce que « Annuler » doit remettre.
            void apply(entity.id, next, { onOptimistic: options.onOptimistic, undoTo: value });
          },
          items,
        },
      ],
    };
  };

  return { entry, apply, choices, hasStatuses: choices.length > 0 };
}

export interface StatusTarget {
  id: number;
  pipelineStatusId?: number | null;
  status?: TaskStatus | null;
}

/**
 * Pastille de la couleur du référentiel — le statut se reconnaît d'abord à sa teinte.
 *
 * Un fragment produit à la demande, pas un composant : ce module exporte un hook, et y
 * déclarer un composant priverait tout le fichier du rechargement à chaud.
 */
function statusDot(color: string | null) {
  if (!color) return <span className="size-3 shrink-0" />;
  return (
    <span
      className="size-2.5 shrink-0 rounded-full ring-1 ring-inset ring-black/20"
      style={{ backgroundColor: color }}
    />
  );
}

// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { MessageKey } from '../i18n';
import type { PipelineStatus } from '../types/shotgrid';
import type { TaskStatus } from '../types/api';
import { TASK_STATUSES, TASK_STATUS_LABEL_KEY } from './taskStatus';

/**
 * Choix de statut d'une entité — logique pure, sans React ni réseau.
 *
 * Changer un statut demandait d'ouvrir la fiche puis un panneau de réglages ; le geste le
 * plus fréquent de la production était le plus coûteux. Il passe désormais par le menu
 * contextuel, partout où une entité est visible. Ce module décrit *quels* choix existent
 * et *quel corps* les traduit — le rendu et l'appel réseau vivent ailleurs.
 */

/** Sentinelle « aucun statut » : le groupe radio ne peut pas porter une valeur vide. */
export const NO_STATUS = 'none';

/** Préfixe des choix de repli, quand un projet n'a pas encore de référentiel. */
export const LEGACY_PREFIX = 'legacy:';

export interface StatusChoice {
  value: string;
  /** Nom du statut tel que le studio l'a écrit — une donnée, jamais traduite. */
  label: string;
  color: string | null;
  statusId: number | null;
  legacyStatus: TaskStatus | null;
}

export type StatusScope = 'task' | 'shot' | 'sequence';

/**
 * Les choix offerts pour un périmètre donné.
 *
 * Sans référentiel, une tâche retombe sur les six valeurs historiques — c'est ce que le
 * kanban manipule déjà. Un plan ou une séquence, lui, n'a pas de repli : leur `PATCH`
 * n'accepte que `pipelineStatusId`, proposer des valeurs qu'il refuserait donnerait un
 * menu qui échoue à tous les coups. Le menu disparaît alors, ce qui est honnête.
 */
export function statusChoices(
  statuses: PipelineStatus[],
  scope: StatusScope,
  t: (key: MessageKey) => string,
): StatusChoice[] {
  if (statuses.length > 0) {
    return statuses.map((status) => ({
      value: String(status.id),
      label: status.name,
      color: status.color,
      statusId: status.id,
      legacyStatus: status.legacyStatus,
    }));
  }
  if (scope !== 'task') return [];
  return TASK_STATUSES.map((status) => ({
    value: `${LEGACY_PREFIX}${status}`,
    label: t(TASK_STATUS_LABEL_KEY[status]),
    color: null,
    statusId: null,
    legacyStatus: status,
  }));
}

/**
 * La valeur cochée dans le groupe.
 *
 * Le repli par famille compte : une entité peut porter un statut hérité d'un autre site
 * (ou d'un projet dont le vocabulaire a changé) qui n'est plus offert ici. Plutôt que de
 * n'afficher aucune coche, on montre le choix de même famille — l'utilisateur voit où il
 * en est au lieu d'un menu qui prétend qu'aucun statut n'est posé.
 */
export function currentStatusValue(
  choices: StatusChoice[],
  entity: { pipelineStatusId?: number | null; status?: TaskStatus | null },
): string {
  if (entity.pipelineStatusId != null) {
    const exact = choices.find((c) => c.statusId === entity.pipelineStatusId);
    if (exact) return exact.value;
  }
  if (entity.status) {
    const sameFamily = choices.find((c) => c.legacyStatus === entity.status);
    if (sameFamily) return sameFamily.value;
  }
  return NO_STATUS;
}

/**
 * Le corps du `PATCH` correspondant à un choix.
 *
 * Jamais `status` **et** `pipelineStatusId` ensemble : le serveur déduit le premier du
 * second et sa déduction prime, si bien qu'envoyer les deux ferait croire à un accord qui
 * n'existe pas.
 */
export function bodyForChoice(
  choices: StatusChoice[],
  value: string,
): { pipelineStatusId?: number | null; status?: TaskStatus } | null {
  if (value === NO_STATUS) return { pipelineStatusId: null };
  const choice = choices.find((c) => c.value === value);
  if (!choice) return null;
  if (choice.statusId != null) return { pipelineStatusId: choice.statusId };
  return choice.legacyStatus ? { status: choice.legacyStatus } : null;
}

/** L'entité telle qu'elle sera après le changement — pour l'affichage optimiste. */
export function withStatusOne<T extends { pipelineStatusId?: number | null; status?: TaskStatus }>(
  entity: T,
  choice: StatusChoice | null,
): T {
  return {
    ...entity,
    pipelineStatusId: choice?.statusId ?? null,
    // Les deux champs bougent ensemble côté affichage : la colonne du kanban lit l'un,
    // la pastille l'autre, et les laisser diverger ferait sauter la carte deux fois.
    ...(choice?.legacyStatus ? { status: choice.legacyStatus } : {}),
  };
}

/** Idem, dans une liste : seul l'élément visé change. */
export function withStatus<T extends { id: number; pipelineStatusId?: number | null; status?: TaskStatus }>(
  list: T[],
  id: number,
  choice: StatusChoice | null,
): T[] {
  return list.map((item) => (item.id === id ? withStatusOne(item, choice) : item));
}

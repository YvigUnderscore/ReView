// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { emitToProject } from '../SocketService';

/**
 * Ce qu'une passe de synchronisation a réellement touché.
 *
 * Chaque entité réalignée émettait son propre événement socket. Sur une passe complète
 * d'un long métrage, cela fait douze mille émissions — et côté navigateur, cinq
 * invalidations de requête par émission. L'écran ne s'en trouve pas plus juste : il
 * passe la durée de la passe à se recharger.
 *
 * On accumule donc, et on décide à la fin :
 * - passe restée petite (relecture d'un webhook, réalignement d'une carte) : les
 *   événements fins sont rejoués tels quels, l'écran se met à jour au bon endroit ;
 * - passe large : un seul résumé, avec le décompte par famille — au client de recharger
 *   ce qu'il affiche, une fois.
 *
 * Le collecteur est volontairement sans dépendance : il ne connaît ni socket ni base,
 * ce qui le rend vérifiable seul.
 */

/** Familles pour lesquelles un événement fin existe déjà côté client. */
export type ReplayableKind = 'sequence' | 'shot' | 'asset' | 'task' | 'version';

/** Les notes et les playlists n'ont pas d'événement fin : elles ne voyagent qu'en décompte. */
export type TouchedKind = ReplayableKind | 'comment' | 'playlist';

export const TOUCHED_EVENT_NAME: Record<ReplayableKind, string> = {
  sequence: 'sequence:update',
  shot: 'shot:update',
  asset: 'asset:update',
  task: 'task:update',
  version: 'version:update',
};

export function isReplayable(kind: TouchedKind): kind is ReplayableKind {
  return Object.prototype.hasOwnProperty.call(TOUCHED_EVENT_NAME, kind);
}

/**
 * Au-delà de ce nombre d'entités distinctes, la passe ne rejoue plus le détail.
 *
 * Vingt-cinq couvre très largement le cas courant — un webhook porte sur une entité, un
 * réalignement manuel sur une — tout en restant sous le seuil où l'invalidation groupée
 * du client coûte moins cher que les invalidations unitaires.
 */
export const DETAIL_LIMIT = 25;

export interface TouchedEvent {
  kind: ReplayableKind;
  id: number;
  /** Champs supplémentaires attendus par le client (rattachements d'une tâche, p. ex.). */
  extra?: Record<string, unknown>;
}

export interface TouchedSummary {
  counts: Partial<Record<TouchedKind, number>>;
  total: number;
  /** `true` : les événements fins ont été rejoués, le client n'a rien à recharger en gros. */
  detailed: boolean;
}

export class TouchedEntities {
  private readonly events: TouchedEvent[] = [];
  private readonly seen = new Set<string>();
  private readonly tally = new Map<TouchedKind, number>();

  /**
   * Note une entité touchée. Une même entité vue deux fois dans la passe ne compte
   * qu'une fois : le décompte dit « combien d'objets ont bougé », pas « combien
   * d'écritures ont eu lieu ».
   */
  add(kind: TouchedKind, id: number, extra?: Record<string, unknown>): void {
    const key = `${kind}:${id}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.tally.set(kind, (this.tally.get(kind) ?? 0) + 1);

    if (!isReplayable(kind)) return;
    // Passé le seuil, le détail ne servira plus : le retenir ferait porter à une passe
    // complète le poids de douze mille objets pour ne rien en émettre.
    if (this.seen.size > DETAIL_LIMIT) {
      this.events.length = 0;
      return;
    }
    this.events.push(extra ? { kind, id, extra } : { kind, id });
  }

  get total(): number {
    return this.seen.size;
  }

  get detailed(): boolean {
    return this.seen.size <= DETAIL_LIMIT;
  }

  /** Événements fins à rejouer — vide dès que la passe a dépassé le seuil. */
  detail(): TouchedEvent[] {
    return this.detailed ? [...this.events] : [];
  }

  summary(): TouchedSummary {
    return {
      counts: Object.fromEntries(this.tally),
      total: this.total,
      detailed: this.detailed,
    };
  }
}

/**
 * Fin de passe : on émet, une fois.
 *
 * Petite passe, les événements fins sont rejoués — l'écran se met à jour exactement là
 * où il faut. Grande passe, un seul `shotgrid:sync` porte le décompte par famille et
 * `detailed: false` : au client de recharger ce qu'il affiche, une fois, au lieu de
 * subir douze mille invalidations.
 *
 * Le résumé part dans tous les cas, y compris quand la passe a échoué en cours de route :
 * ce qu'elle a déjà réaligné est réel et doit atteindre les écrans ouverts.
 */
export function flushTouched(
  projectId: number,
  runId: number,
  status: 'ok' | 'error',
  touched: TouchedEntities,
): void {
  for (const event of touched.detail()) {
    emitToProject(projectId, TOUCHED_EVENT_NAME[event.kind], {
      projectId,
      id: event.id,
      ...event.extra,
    });
  }
  emitToProject(projectId, 'shotgrid:sync', { projectId, runId, status, ...touched.summary() });
}

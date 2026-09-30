// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Ce que le panneau annonce au retour d'une demande de synchronisation — logique pure.
 *
 * Le serveur distingue trois issues là où l'écran n'en lisait que deux. Une demande
 * arrivée pendant qu'une passe tournait rend `deferred` : elle est fusionnée avec la
 * demande en attente et rejouée à la fin de la passe en cours, mais rien n'a encore eu
 * lieu. L'annoncer en vert « Synchronisation terminée » envoie chercher dans la liste des
 * exécutions un résultat qui n'y est pas — c'est très exactement la confusion que le
 * statut `deferred` existe pour lever.
 */

/** Le vert est réservé à un travail réellement fait ; la mise en file s'annonce en neutre. */
export type SyncTone = 'success' | 'info' | 'error';

export interface SyncOutcome {
  tone: SyncTone;
  key: 'shotgrid.sync.done' | 'shotgrid.sync.failed' | 'shotgrid.sync.queued';
}

/**
 * Statut rendu par l'API → bandeau à afficher. Un statut inconnu retombe sur « terminé » :
 * la passe a bien eu lieu, seul son détail nous échappe.
 */
export function syncOutcome(status: string | undefined): SyncOutcome {
  if (status === 'error') return { tone: 'error', key: 'shotgrid.sync.failed' };
  if (status === 'deferred') return { tone: 'info', key: 'shotgrid.sync.queued' };
  return { tone: 'success', key: 'shotgrid.sync.done' };
}

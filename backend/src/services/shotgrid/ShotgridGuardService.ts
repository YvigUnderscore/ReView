// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { parseSettings, sgCreateLink } from './shotgridSettings';

/**
 * Verrou de création locale.
 *
 * Quand un projet est piloté depuis ShotGrid, y créer un plan côté ReView produit une
 * entité orpheline : elle n'existe pas dans le registre de production, personne ne la
 * verra dans les rapports, et la prochaine synchronisation ne saura pas quoi en faire.
 * Plutôt que de la laisser naître pour la signaler ensuite comme un écart, on refuse
 * la création et on renvoie vers le formulaire ShotGrid correspondant — pré-rempli sur
 * le bon projet.
 *
 * Le verrou se lève dans les réglages du projet : certains studios préfèrent créer
 * depuis ReView (la création miroir écrit alors d'abord dans ShotGrid).
 */

export type CreatableKind = 'sequence' | 'shot' | 'asset';

const SG_ENTITY: Record<CreatableKind, string> = {
  sequence: 'Sequence',
  shot: 'Shot',
  asset: 'Asset',
};

/** Erreur porteuse du lien de création distant — le client en fait un bouton. */
export class ShotgridLockedError extends AppError {
  constructor(
    message: string,
    readonly sgCreateUrl: string,
    readonly sgProjectName: string,
  ) {
    super(message, 409, 'SHOTGRID_LOCKED', { sgCreateUrl, sgProjectName });
    this.name = 'ShotgridLockedError';
  }
}

export interface LockState {
  locked: boolean;
  sgCreateUrl?: string;
  sgProjectName?: string;
}

export async function creationLockState(projectId: number, kind: CreatableKind): Promise<LockState> {
  const conn = await prisma.shotgridConnection.findUnique({
    where: { projectId },
    include: { site: true },
  });
  if (!conn?.active) return { locked: false };
  const settings = parseSettings(conn.settings);
  if (!settings.lockLocalCreation) return { locked: false };
  return {
    locked: true,
    sgCreateUrl: sgCreateLink(conn.site.baseUrl, SG_ENTITY[kind], conn.sgProjectId),
    sgProjectName: conn.sgProjectName,
  };
}

/**
 * Refuse la création si le projet est piloté depuis ShotGrid.
 * Appelée par les routes de création de séquences, plans et assets.
 */
export async function assertLocalCreationAllowed(projectId: number, kind: CreatableKind): Promise<void> {
  const state = await creationLockState(projectId, kind);
  if (!state.locked) return;
  throw new ShotgridLockedError(
    `Ce projet est piloté depuis ShotGrid (« ${state.sgProjectName} ») — créer l'élément dans ShotGrid, il reviendra à la synchronisation suivante`,
    state.sgCreateUrl!,
    state.sgProjectName!,
  );
}

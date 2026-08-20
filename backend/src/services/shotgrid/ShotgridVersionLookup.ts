// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { belongsToProject, projectFilter, type ProjectScope } from './shotgridProjectGuard';
import type { ShotgridClient } from './ShotgridClient';
import { logger } from '../../lib/logger';

/**
 * Une Version portant déjà ce code existe-t-elle sur le site ?
 *
 * Publier depuis ReView créait une Version sans jamais regarder s'il y en avait une du
 * même nom. Le cas est courant : un artiste publie dans ReView un travail dont la Version
 * a déjà été créée sur le site par son outil de rendu. Le site se retrouvait alors avec
 * deux entrées identiques, et la production ne savait plus laquelle regarder — un doublon
 * ne se rattrape pas depuis ici, il faut le supprimer à la main là-bas.
 *
 * Deux homonymes : on n'en choisit aucun. Se tromper de rattachement coûte plus cher que
 * de créer une Version de plus, qu'un humain verra.
 */
export async function findVersionByCode(
  ctx: { client: ShotgridClient; scope: ProjectScope },
  code: string,
): Promise<number | null> {
  const trimmed = code.trim();
  if (!trimmed) return null;
  const records = await ctx.client.search('Version', {
    fields: ['id', 'code', 'project'],
    // Le filtre de projet est obligatoire : un site héberge tous les projets du studio,
    // et un code de version se répète volontiers d'un projet à l'autre.
    filters: [projectFilter(ctx.scope.sgProjectId), ['code', 'is', trimmed]],
    maxRecords: 5,
  });
  // Chaque enregistrement est revérifié : le filtre peut être contourné par une
  // configuration de site inattendue, et écrire dans le projet voisin ne se rattrape pas.
  const mine = records.filter((r) => belongsToProject(r, ctx.scope).ok);
  if (mine.length !== 1) {
    if (mine.length > 1) {
      logger.warn({ code: trimmed, count: mine.length }, 'Plusieurs Versions ShotGrid du même code');
    }
    return null;
  }
  return mine[0]!.id;
}

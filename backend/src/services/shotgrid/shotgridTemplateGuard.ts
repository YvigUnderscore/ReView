// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { logger } from '../../lib/logger';
import { badRequest } from '../../lib/errors';
import { asString, type SgRecord } from './shotgridMapper';

/**
 * Protection des projets modèles de ShotGrid.
 *
 * Un site de studio garde des projets qui servent de gabarit à tous les autres
 * (« Template Project » et ses variantes). Y écrire ne casse pas un projet : ça casse
 * tous ceux qui en seront tirés ensuite, et personne ne fait le lien avant longtemps.
 *
 * Le cloisonnement par projet suffit en théorie — un modèle n'est pas le projet lié.
 * Cette garde existe pour le cas où la théorie serait fausse : identifiant ressaisi à
 * la main, projet renommé, lien hérité d'un essai. Elle refuse la liaison comme
 * l'écriture, sans jamais se fier au seul identifiant.
 */

/** Motifs de nom qui désignent un gabarit sur un site ShotGrid. */
const TEMPLATE_PATTERNS = [
  /^template\b/i,
  /\btemplate\s*project\b/i,
  /^_?template/i,
  /\bproject\s*template\b/i,
  /^zzz?[_ -]?template/i,
];

export function looksLikeTemplate(name: string | null | undefined): boolean {
  if (!name) return false;
  const trimmed = name.trim();
  return TEMPLATE_PATTERNS.some((re) => re.test(trimmed));
}

/**
 * Un projet ShotGrid peut-il être relié ? Un gabarit est refusé à la source : c'est le
 * moment le plus sûr pour dire non, avant qu'une seule requête ne parte.
 */
export function assertNotTemplateProject(name: string | null | undefined, sgProjectId: number): void {
  if (!looksLikeTemplate(name)) return;
  logger.warn({ sgProjectId, name }, 'Tentative de liaison à un projet modèle ShotGrid — refusée');
  throw badRequest(
    `« ${name} » est un projet modèle ShotGrid : le relier exposerait tous les projets qui en seront tirés. Choisir un projet de production.`,
  );
}

/**
 * Dernier rempart avant une écriture : la cible appartient-elle à un gabarit ?
 * Renvoie `false` pour laisser l'appelant abandonner proprement plutôt que lever —
 * une écriture refusée se journalise, elle n'interrompt pas une synchronisation.
 */
export function writeAllowedOn(record: SgRecord | null | undefined): boolean {
  if (!record) return false;
  if (record.type === 'Project') return !looksLikeTemplate(asString(record.name));
  const project = record.project as { name?: unknown } | null | undefined;
  return !looksLikeTemplate(asString(project?.name));
}

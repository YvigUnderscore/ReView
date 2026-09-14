// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { logger } from '../../lib/logger';
import { badRequest, forbidden } from '../../lib/errors';
import type { ShotgridClient } from './ShotgridClient';
import { belongsToProject, type ProjectScope } from './shotgridProjectGuard';
import { writeAllowedOn } from './shotgridTemplateGuard';
import { asEntityRef, type SgRecord } from './shotgridMapper';

/**
 * Le seul chemin par lequel ReView écrit dans ShotGrid.
 *
 * Les contrôles de cloisonnement existaient déjà — relecture de la cible,
 * `belongsToProject`, refus des projets modèles — mais ils reposaient sur la **mémoire de
 * celui qui écrit le code** : rien n'empêchait un nouvel appel de parler au client
 * directement. La preuve que ça glisse est dans l'historique : `ShotgridPlaylistSync`
 * avait recopié les trois vérifications à la main au lieu de réutiliser `resolveTarget`,
 * et deux copies d'une même règle finissent toujours par diverger.
 *
 * Ce module transforme la discipline en contrainte. Les méthodes brutes du client sont
 * préfixées `unsafe` et ne s'appellent plus nulle part ailleurs — `ShotgridWriteGuard.test.ts`
 * fait échouer la suite si l'une d'elles réapparaît hors d'ici. Écrire dans le mauvais
 * projet redevient ce que ça aurait toujours dû être : une erreur qu'on ne peut pas
 * commettre par distraction.
 *
 * **Ce que ce garde-fou ne couvre pas**, et qu'aucun code ne couvrira :
 *
 *  - *La fenêtre entre la relecture et l'écriture.* L'API REST de ShotGrid n'offre aucune
 *    écriture conditionnelle : entre le moment où l'on vérifie le projet d'une entité et
 *    celui où on l'écrit, rien ne garantit formellement qu'elle n'a pas bougé. Quelques
 *    millisecondes, et une relecture qui rend le cas négligeable — mais pas nul.
 *  - *Une connexion pointée sur le mauvais projet dès le départ.* Toutes les écritures
 *    partent alors au « bon » endroit d'une prémisse fausse. C'est `createConnection`
 *    (identifiant **et** nom confrontés) et `openConnection` (nom revérifié avant chaque
 *    passe) qui tiennent ce bout-là.
 */

export interface WriterScope extends ProjectScope {
  client: ShotgridClient;
}

/** Champs relus pour trancher : l'identité, le projet, et le nom du projet pour le gabarit. */
const GUARD_FIELDS = ['id', 'project'];

export class ShotgridWriter {
  constructor(private readonly scope: WriterScope) {}

  private get projectScope(): ProjectScope {
    return { sgProjectId: this.scope.sgProjectId, sgProjectName: this.scope.sgProjectName };
  }

  /**
   * La cible est-elle écrivable ? Relecture, cloisonnement, gabarit.
   *
   * Rend `false` plutôt que de lever : une écriture refusée se journalise et la
   * synchronisation continue. C'est le comportement qu'avaient déjà `resolveTarget` et
   * la garde recopiée dans les playlists.
   */
  private async targetWritable(sgType: string, sgId: number): Promise<boolean> {
    const remote = await this.scope.client.findById(sgType, sgId, GUARD_FIELDS);
    if (!remote) {
      logger.warn({ sgType, sgId }, 'Écriture ShotGrid abandonnée : cible introuvable sur le site');
      return false;
    }
    const verdict = belongsToProject(remote, this.projectScope);
    if (!verdict.ok) {
      logger.error(
        { sgType, sgId, expected: this.scope.sgProjectId, found: verdict.foundProjectId },
        'Écriture ShotGrid annulée : la cible appartient à un autre projet',
      );
      return false;
    }
    if (!writeAllowedOn(remote)) {
      logger.error({ sgType, sgId }, 'Écriture ShotGrid annulée : cible dans un projet modèle');
      return false;
    }
    return true;
  }

  /**
   * Modifie une entité existante. `null` quand l'écriture a été refusée — l'appelant
   * n'a rien de plus à faire, le refus est déjà journalisé.
   */
  async update(
    sgType: string,
    sgId: number,
    data: Record<string, unknown>,
    options: { asUserLogin?: string | null } = {},
  ): Promise<SgRecord | null> {
    if (!(await this.targetWritable(sgType, sgId))) return null;
    return this.scope.client.unsafeUpdate(sgType, sgId, data, options);
  }

  /**
   * Crée une entité **dans le projet lié**.
   *
   * Le `project` est posé ici et nulle part ailleurs : un appelant ne peut ni l'oublier
   * ni en viser un autre. Une charge utile qui en porte un différent est une erreur de
   * programmation, pas une donnée à arbitrer — on lève.
   *
   * La relecture qui suit n'est pas de la superstition : c'est le site qui décide de ce
   * qu'il a réellement écrit, et une entité déposée dans la production de quelqu'un
   * d'autre ne se rattrape pas toute seule.
   */
  async create(
    sgType: string,
    data: Record<string, unknown>,
    options: { asUserLogin?: string | null } = {},
  ): Promise<SgRecord> {
    const asked = asEntityRef(data.project);
    if (asked && asked.id !== this.scope.sgProjectId) {
      logger.error(
        { sgType, asked: asked.id, expected: this.scope.sgProjectId },
        'Création ShotGrid refusée : la charge utile vise un autre projet',
      );
      throw badRequest('ShotGrid payload targets another project');
    }

    const created = await this.scope.client.unsafeCreate(
      sgType,
      { ...data, project: { type: 'Project', id: this.scope.sgProjectId } },
      options.asUserLogin ?? null,
    );

    const check = await this.scope.client.findById(sgType, created.id, GUARD_FIELDS);
    if (check && !belongsToProject(check, this.projectScope).ok) {
      logger.error(
        { sgType, sgId: created.id, expected: this.scope.sgProjectId },
        'Entité créée hors du projet lié — à retirer du site',
      );
      throw badRequest('ShotGrid filed the entity outside the target project');
    }
    if (check && !writeAllowedOn(check)) {
      throw forbidden('ShotGrid template project — writing is refused');
    }
    return created;
  }

  /** Dépose un fichier sur une entité — même relecture que `update`. */
  async upload(
    sgType: string,
    sgId: number,
    field: string,
    body: Buffer,
    filename: string,
    contentType: string,
  ): Promise<boolean> {
    if (!(await this.targetWritable(sgType, sgId))) return false;
    await this.scope.client.unsafeUploadFile(sgType, sgId, field, body, filename, contentType);
    return true;
  }
}

/** Writer d'une connexion — c'est la seule façon d'en obtenir un. */
export function writerFor(scope: WriterScope): ShotgridWriter {
  return new ShotgridWriter(scope);
}

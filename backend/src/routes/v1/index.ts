// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router, type Router as ExpressRouter } from 'express';
import { authenticate } from '../../middleware/auth';
import metaRoutes from './meta.routes';
import projectsRoutes from './projects.routes';
import projectContentRoutes from './project-content.routes';
import entitiesRoutes from './entities.routes';
import tasksRoutes from './tasks.routes';
import versionsRoutes from './versions.routes';
import publishRoutes from './publish.routes';
import commentsRoutes from './comments.routes';
import eventsRoutes from './events.routes';

/**
 * API d'intégration v1 — surface stable destinée aux outils : DCC (Maya, Blender,
 * Houdini, Nuke), gestionnaires de pipeline (Prism), bots et synchronisations tierces.
 *
 * Elle est séparée de `/api`, qui sert l'interface web : celle-ci suit le produit et
 * change au rythme des écrans, quand une intégration installée sur les postes d'un studio
 * ne peut pas être mise à jour à chaque livraison. Ce qui est publié ici ne bougera pas
 * sans changement de version.
 *
 * Particularités par rapport à `/api` :
 *  - les entités s'adressent par **chemin** (`PROJ/SQ010/SH0100/anim`) autant que par id ;
 *  - les créations sont **idempotentes** (« ensure ») et acceptent `Idempotency-Key` ;
 *  - chaque route exige un **scope** explicite quand l'appel porte un token d'API.
 */

export const V1_BASE_PATH = '/api/v1';

/**
 * Table de montage — source unique du plan d'URL v1. Elle sert au montage Express ET à
 * la génération OpenAPI (`lib/openapiRoutes`) : impossible qu'un endpoint existe sans
 * être documenté, ou qu'un chemin documenté ne corresponde à rien.
 *
 * Les entités par identifiant et les fils de commentaires sont montés à la racine : leurs
 * chemins portent déjà leur préfixe (`/shots/:id`, `/media/:id/comments`).
 */
export const V1_MOUNTS: { prefix: string; router: ExpressRouter }[] = [
  { prefix: '', router: metaRoutes },
  { prefix: '/projects', router: projectsRoutes },
  { prefix: '/projects', router: projectContentRoutes },
  { prefix: '/publish', router: publishRoutes },
  { prefix: '/events', router: eventsRoutes },
  { prefix: '', router: entitiesRoutes },
  { prefix: '', router: tasksRoutes },
  { prefix: '', router: versionsRoutes },
  { prefix: '', router: commentsRoutes },
];

const router = Router();
router.use(authenticate);
for (const { prefix, router: sub } of V1_MOUNTS) router.use(prefix === '' ? '/' : prefix, sub);

export default router;

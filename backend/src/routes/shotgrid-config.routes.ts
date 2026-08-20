// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import { env } from '../config/env';
import * as Config from '../services/shotgrid/ShotgridConfigService';
import { parseSettings, shotgridSettingsSchema } from '../services/shotgrid/shotgridSettings';
import { assertProjectManager } from '../lib/shotgridAccess';
import { scheduleShotgridJobs } from '../services/shotgrid/ShotgridSchedule';
import { logger } from '../lib/logger';
import type { Request } from 'express';

/**
 * Configuration ShotGrid : sites du studio (ADMIN) et connexion d'un projet
 * (ADMIN ou superviseur du projet). Aucune clé ni mot de passe ne ressort de l'API.
 */
const router = Router();
router.use(authenticate);

/** Adresse publique de l'instance : réglage explicite, sinon origine de la requête. */
const publicUrl = (req: Request): string =>
  env.APP_URL ?? `${req.protocol}://${req.get('host') ?? 'localhost'}`;

const idParam = z.object({ id: z.coerce.number().int().positive() });
const projectParam = z.object({ projectId: z.coerce.number().int().positive() });

const siteBody = z.object({
  name: z.string().min(1).max(80),
  baseUrl: z.string().min(8).max(300),
  authMode: z.enum(['script', 'user']),
  scriptName: z.string().max(120).nullish(),
  scriptKey: z.string().max(300).nullish(),
  login: z.string().max(160).nullish(),
  password: z.string().max(300).nullish(),
});

router.get('/sites', requireRole(Role.ADMIN), async (_req, res) => {
  res.json({ sites: await Config.listSites() });
});

router.post('/sites', requireRole(Role.ADMIN), validate({ body: siteBody }), async (req, res) => {
  res.status(201).json({ site: await Config.createSite(req.body) });
});

router.patch(
  '/sites/:id',
  requireRole(Role.ADMIN),
  validate({ params: idParam, body: siteBody.partial() }),
  async (req, res) => {
    res.json({ site: await Config.updateSite(Number(req.params.id), req.body) });
  },
);

router.delete('/sites/:id', requireRole(Role.ADMIN), validate({ params: idParam }), async (req, res) => {
  await Config.deleteSite(Number(req.params.id));
  res.status(204).end();
});

/** Test d'authentification réel contre le site. */
router.post('/sites/:id/test', requireRole(Role.ADMIN), validate({ params: idParam }), async (req, res) => {
  res.json(await Config.testSite(Number(req.params.id)));
});

/**
 * Projets du site. C'est cette liste qui permet à l'utilisateur de désigner sa cible
 * par son nom : l'identifiant seul serait indéchiffrable, et se tromper de projet est
 * l'erreur qu'on cherche à rendre impossible.
 */
router.get(
  '/sites/:id/projects',
  validate({ params: idParam, query: z.object({ query: z.string().max(120).optional() }) }),
  async (req, res) => {
    if (req.user!.role !== Role.ADMIN && req.user!.role !== Role.SUPERVISOR)
      return res.status(403).json({ error: 'Supervisors and administrators only' });
    res.json({
      projects: await Config.listRemoteProjects(Number(req.params.id), req.query.query as string | undefined),
    });
  },
);

// ───────────────────────────── Connexion d'un projet ─────────────────────────────

const connectionBody = z.object({
  siteId: z.number().int().positive(),
  sgProjectId: z.number().int().positive(),
  // Nom affiché à l'utilisateur au moment du choix : confronté au nom réel avant
  // d'enregistrer quoi que ce soit.
  sgProjectName: z.string().min(1).max(200),
});

router.post(
  '/projects/:projectId/connection',
  validate({ params: projectParam, body: connectionBody }),
  async (req, res) => {
    const projectId = Number(req.params.projectId);
    await assertProjectManager(req.user!, projectId);
    const conn = await Config.createConnection(projectId, req.body);
    res.status(201).json({ connection: Config.connectionView(conn, publicUrl(req)) });
  },
);

router.get('/projects/:projectId/connection', validate({ params: projectParam }), async (req, res) => {
  const projectId = Number(req.params.projectId);
  await assertProjectManager(req.user!, projectId, { allowMembers: true });
  const conn = await Config.getConnection(projectId);
  res.json({ connection: conn ? Config.connectionView(conn, publicUrl(req)) : null });
});

router.patch(
  '/projects/:projectId/connection',
  validate({
    params: projectParam,
    body: z.object({
      settings: shotgridSettingsSchema.partial().optional(),
      active: z.boolean().optional(),
      webhookSecret: z.string().max(200).nullish(),
    }),
  }),
  async (req, res) => {
    const projectId = Number(req.params.projectId);
    await assertProjectManager(req.user!, projectId);
    const current = await Config.getConnectionOrThrow(projectId);
    // Fusion : l'UI n'envoie que la section modifiée, le reste doit survivre.
    // En profondeur d'un cran, et à partir des réglages **normalisés** : la fusion plate
    // laissait `shotgridSettingsSchema.partial()` reparser chaque section reçue avec ses
    // défauts, si bien qu'envoyer un seul domaine remettait les six autres à
    // « lecture + écriture ». Un client qui n'envoie qu'un champ rouvrait des écritures.
    const merged = req.body.settings
      ? Config.mergeSettings(parseSettings(current.settings), req.body.settings)
      : undefined;
    // Rouvrir un domaine en écriture efface son alerte : la bannière signale un problème
    // en cours, pas une trace historique.
    const cleared = merged ? Config.clearedBlocks(current.pushBlocked, merged) : undefined;
    const conn = await Config.updateConnection(projectId, {
      ...req.body,
      settings: merged,
      ...(cleared ? { pushBlocked: cleared } : {}),
    });
    // Le rythme (mode d'événements, intervalle de relevé, heure de réconciliation) vit
    // dans des travaux répétables Redis, posés une seule fois au démarrage. Sans cette
    // repose, basculer une connexion en « relevé » ne relevait rien jusqu'au prochain
    // redémarrage — le réglage semblait pris en compte et ne l'était pas.
    void scheduleShotgridJobs().catch((err: unknown) => {
      logger.error({ err, projectId }, 'Repose des travaux périodiques ShotGrid impossible');
    });
    res.json({ connection: Config.connectionView(conn, publicUrl(req)) });
  },
);

router.delete('/projects/:projectId/connection', validate({ params: projectParam }), async (req, res) => {
  const projectId = Number(req.params.projectId);
  await assertProjectManager(req.user!, projectId, { adminOnly: true });
  await Config.deleteConnection(projectId);
  res.status(204).end();
});

/** Rotation du jeton d'URL du webhook (l'ancienne adresse cesse aussitôt de répondre). */
router.post(
  '/projects/:projectId/connection/rotate-token',
  validate({ params: projectParam }),
  async (req, res) => {
    const projectId = Number(req.params.projectId);
    await assertProjectManager(req.user!, projectId);
    const conn = await Config.rotateWebhookToken(projectId);
    res.json({ connection: Config.connectionView(conn, publicUrl(req)) });
  },
);

export default router;

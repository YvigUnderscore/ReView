// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate';
import { requireScope } from '../../middleware/scope';
import { reviewNoteSchema } from '../../lib/projectSettings';
import * as ReviewAssignmentService from '../../services/ReviewAssignmentService';
import * as ReviewDecisionService from '../../services/ReviewDecisionService';
import { actorOf, idParam, requireVersionProject } from './helpers';

/**
 * Le tour de la review, côté intégrations : qui doit regarder quoi, et ce que le studio a
 * conclu.
 *
 * Trois manques que cette famille solde. `POST /versions/{id}/decision` existait depuis la
 * Phase 31 et réclame un `statusId`, sans qu'aucune route v1 ne permette de DÉCOUVRIR ces
 * identifiants — un intégrateur les lisait en base ou les codait en dur, et un studio qui
 * renommait son vocabulaire cassait le script. L'historique des décisions, que tout rapport
 * de production vient chercher, n'était rendu nulle part. Et l'assignation de review
 * (Phase 49) vivait sur la seule API web, alors que c'est exactement ce qu'un bot de
 * production veut écrire après un rendu de nuit.
 */
const router = Router();

const reviewerParam = idParam.extend({ userId: z.coerce.number().int().positive() });
const note = reviewNoteSchema.describe(
  'Ce que cette personne doit regarder. Le projet peut l’exiger et lui imposer une ' +
    'longueur minimale (GET /api/v1/projects/{ref}/settings, section « reviewRequest ») : ' +
    'une consigne manquante ou trop courte refuse alors l’écriture.',
);

// ── À qui la review d'une version est confiée ────────────────────────────────

router.get(
  '/versions/:id/reviewers',
  requireScope('versions:read'),
  validate({ params: idParam }),
  async (req, res) => {
    const id = Number(req.params.id);
    await requireVersionProject(req, id);
    res.json({ reviewers: await ReviewAssignmentService.listReviewers(id) });
  },
);

/**
 * PUT /api/v1/versions/{id}/reviewers — remplace la liste, consignes comprises.
 *
 * Remplacement et non ajout : un script décrit l'état voulu (« ces trois-là »), il ne
 * compose pas une liste par accumulation. Réservé au gestionnaire du projet et à l'auteur
 * de la version, comme depuis l'interface.
 */
router.put(
  '/versions/:id/reviewers',
  requireScope('versions:write'),
  validate({ params: idParam, body: z.object({ reviewers: ReviewAssignmentService.reviewersSchema }) }),
  async (req, res) => {
    const id = Number(req.params.id);
    const projectId = await requireVersionProject(req, id);
    const reviewers = await ReviewAssignmentService.setReviewers(
      actorOf(req),
      projectId,
      id,
      req.body.reviewers,
    );
    res.json({ reviewers });
  },
);

// PATCH /api/v1/versions/{id}/reviewers/{userId} — réécrit la consigne d'une seule personne.
router.patch(
  '/versions/:id/reviewers/:userId',
  requireScope('versions:write'),
  validate({ params: reviewerParam, body: z.object({ note }) }),
  async (req, res) => {
    const id = Number(req.params.id);
    const projectId = await requireVersionProject(req, id);
    const reviewers = await ReviewAssignmentService.updateNote(
      actorOf(req),
      projectId,
      id,
      Number(req.params.userId),
      req.body.note ?? null,
    );
    res.json({ reviewers });
  },
);

// ── Vocabulaire et historique des décisions ──────────────────────────────────

/**
 * GET /api/v1/review-statuses — les statuts que le studio emploie, et leurs identifiants.
 *
 * `projectId` restreint au vocabulaire réellement postable sur ce projet : sur un projet
 * relié à ShotGrid, seuls les statuts qui ont une correspondance sur le site sont offerts,
 * et poster un autre n'irait nulle part.
 */
router.get(
  '/review-statuses',
  requireScope('versions:read'),
  validate({ query: z.object({ projectId: z.coerce.number().int().positive().optional() }) }),
  async (req, res) => {
    // Express 5 : la validation fusionne, elle ne remplace pas — la valeur reste une chaîne.
    const raw = req.query.projectId;
    const projectId = raw === undefined ? undefined : Number(raw);
    res.json({
      statuses:
        projectId && Number.isInteger(projectId)
          ? await ReviewDecisionService.listStatusesForProject(projectId)
          : await ReviewDecisionService.listStatuses(),
    });
  },
);

// GET /api/v1/versions/{id}/decisions — l'historique, de la plus récente à la plus ancienne.
router.get(
  '/versions/:id/decisions',
  requireScope('versions:read'),
  validate({ params: idParam }),
  async (req, res) => {
    const id = Number(req.params.id);
    await requireVersionProject(req, id);
    res.json({ decisions: await ReviewDecisionService.history(id) });
  },
);

export default router;

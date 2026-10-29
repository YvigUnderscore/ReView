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
import mediaRoutes from './media.routes';
import latestRoutes from './latest.routes';
import publishRoutes from './publish.routes';
import commentsRoutes from './comments.routes';
import eventsRoutes from './events.routes';
import episodesRoutes from './episodes.routes';
import entityExtrasRoutes from './entity-extras.routes';
import reviewRoutes from './review.routes';

/**
 * Stable v1 integration API, intended for tools: DCCs (Maya, Blender, Houdini, Nuke), pipeline
 * managers (Prism), bots and third-party syncs.
 *
 * It is separate from `/api`, which serves the web UI: the UI follows the product and changes
 * with the screens, whereas an integration installed on a studio's workstations cannot be
 * updated at every release. What is published here will not change without a version bump.
 *
 * Differences from `/api`:
 *  - entities are addressed by **path** (`PROJ/SQ010/SH0100/anim`) as well as by id;
 *  - creations are **idempotent** ("ensure") and accept `Idempotency-Key`;
 *  - every route requires an explicit **scope** when the call carries an API token.
 */

export const V1_BASE_PATH = '/api/v1';

/**
 * Mount table: the single source of the v1 URL plan. It drives both the Express mounting AND
 * OpenAPI generation (`lib/openapiRoutes`), so an endpoint cannot exist undocumented, nor a
 * documented path point to nothing.
 *
 * Entities by identifier and comment threads are mounted at the root: their paths already carry
 * their prefix (`/shots/:id`, `/media/:id/comments`).
 */
export const V1_MOUNTS: { prefix: string; router: ExpressRouter }[] = [
  { prefix: '', router: metaRoutes },
  { prefix: '/projects', router: projectsRoutes },
  { prefix: '/projects', router: projectContentRoutes },
  { prefix: '/publish', router: publishRoutes },
  { prefix: '/events', router: eventsRoutes },
  // The episode level, mounted before entities: its two paths already carry their prefix
  // (`/projects/:ref/episodes`, `/episodes/:id`).
  { prefix: '', router: episodesRoutes },
  { prefix: '', router: entitiesRoutes },
  { prefix: '', router: tasksRoutes },
  { prefix: '', router: versionsRoutes },
  // What an entity carries beyond its record: its owners and its brief.
  { prefix: '', router: entityExtrasRoutes },
  // File reads and "latest version": mounted after the collections whose paths they extend
  // (`/tasks/:id/versions/latest` after `/tasks/:id/versions`).
  { prefix: '', router: mediaRoutes },
  { prefix: '', router: latestRoutes },
  { prefix: '', router: commentsRoutes },
  // The review round: who is expected on a media, the decision vocabulary, and the history.
  // Mounted after media and versions, whose paths it extends.
  { prefix: '', router: reviewRoutes },
];

const router = Router();
router.use(authenticate);
for (const { prefix, router: sub } of V1_MOUNTS) router.use(prefix === '' ? '/' : prefix, sub);

export default router;

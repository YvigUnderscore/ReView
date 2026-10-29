// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { z } from 'zod';
import { cameraStateSchema, guestAnnotationSchema } from '../lib/commentPayload';

/**
 * What a guest is allowed to send on the public sharing surface.
 *
 * Extracted from `client.routes.ts` for its line budget, but the grouping stands on its own: this is
 * where, and nowhere else, one reads what an anonymous visitor holding a link can write to the database.
 * The schemas are still replayed at write time by the services: a route is not the only possible caller.
 */

/** Written feedback, with its drawing and, for a spatial media, the camera pose. */
export const guestCommentBody = z.object({
  guestName: z.string().trim().min(1).max(80),
  content: z.string().min(1).max(10000),
  timestamp: z.number().nonnegative().optional(),
  // Same schema as the internal review (A2-04); `createGuest` revalidates it in any case.
  cameraState: cameraStateSchema.nullish(),
  // GUEST schema: neither 3D staging, nor camera animation, nor painter strokes: these are gestures
  // replayed for all the viewers of the media. Without this key, `validate` replacing `req.body` with
  // the parsed one, the annotation went to the server, received a 201, and was never written.
  annotation: guestAnnotationSchema.nullish(),
});

/**
 * Opinion on a version. `statusId` is not taken on trust: `decideAsGuest` restricts it to the two
 * answers offered, failing which a guest could post any internal status.
 */
export const guestDecisionBody = z.object({
  guestName: z.string().trim().min(1).max(80),
  statusId: z.number().int().positive(),
  comment: z.string().max(2000).optional(),
});

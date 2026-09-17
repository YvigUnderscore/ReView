// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { z } from 'zod';
import { cameraStateSchema, guestAnnotationSchema } from '../lib/commentPayload';

/**
 * Ce qu'un invité a le droit d'envoyer sur la surface publique de partage.
 *
 * Extrait de `client.routes.ts` pour son budget de lignes, mais le regroupement se tient de
 * lui-même : c'est ici, et nulle part ailleurs, qu'on lit ce qu'un anonyme muni d'un lien
 * peut écrire en base. Les schémas restent rejoués à l'écriture par les services — une
 * route n'est pas le seul appelant possible.
 */

/** Retour écrit, avec son dessin et, pour un média spatial, la pose caméra. */
export const guestCommentBody = z.object({
  guestName: z.string().trim().min(1).max(80),
  content: z.string().min(1).max(10000),
  timestamp: z.number().nonnegative().optional(),
  // Même schéma que la review interne (A2-04) ; `createGuest` le revalide de toute façon.
  cameraState: cameraStateSchema.nullish(),
  // Schéma INVITÉ : ni mise en scène 3D, ni animation caméra, ni traits du painter — ce
  // sont des gestes rejoués pour tous les spectateurs du média. Sans cette clé, `validate`
  // remplaçant `req.body` par le parsé, l'annotation partait au serveur, recevait un 201, et
  // n'était jamais écrite.
  annotation: guestAnnotationSchema.nullish(),
});

/**
 * Avis sur une version. `statusId` n'est pas cru sur parole : `decideAsGuest` le restreint
 * aux deux réponses offertes, faute de quoi un invité poserait n'importe quel statut interne.
 */
export const guestDecisionBody = z.object({
  guestName: z.string().trim().min(1).max(80),
  statusId: z.number().int().positive(),
  comment: z.string().max(2000).optional(),
});

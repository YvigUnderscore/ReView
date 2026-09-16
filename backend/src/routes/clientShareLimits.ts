// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Request, RequestHandler } from 'express';
import { rateLimit } from '../middleware/rateLimit';

/**
 * Freins de débit de la surface PUBLIQUE de partage (A2-02).
 *
 * `POST /api/client/:token/media/:id/comments` écrit en base sur présentation d'un lien,
 * sans compte derrière : ni `authenticate`, ni le plafond par identité du limiteur global,
 * qui retombe ici sur l'IP. C'était donc la seule écriture de l'application ouverte à un
 * anonyme et non freinée — chaque appel crée une ligne `Comment`, déclenche une diffusion
 * socket, un webhook sortant, une entrée de journal v1 et une note ShotGrid.
 *
 * Deux compteurs, parce qu'aucun des deux ne suffit seul :
 *
 *  - **par lien** : sous `TRUST_PROXY`, `req.ip` est ce que l'en-tête `X-Forwarded-For`
 *    déclare, donc une valeur que l'appelant choisit. Une clé qui contient l'IP se
 *    renouvelle à volonté et ne borne plus rien. Le jeton de partage, lui, est dans l'URL
 *    et ne peut pas être changé sans perdre l'accès : c'est le seul discriminant
 *    infalsifiable de cette surface, et donc le seul plafond qui tienne vraiment.
 *  - **par lien et par IP**, plus serré : il empêche un client bavard — ou une boucle de
 *    son navigateur — d'avaler à lui seul le budget du lien au détriment des autres
 *    invités. Il ne prétend pas résister à une IP falsifiée ; c'est le premier qui s'en
 *    charge.
 *
 * Le limiteur échoue fermé (cf. `middleware/rateLimit`) : Redis muet ⇒ 429.
 */

const WINDOW_MS = 15 * 60 * 1000;
/** Budget d'un lien de partage, tous invités confondus. */
const PER_LINK_MAX = 120;
/** Budget d'un invité identifié par son adresse — sous-ensemble du précédent. */
const PER_LINK_AND_IP_MAX = 30;

const TOO_MANY = { error: 'Too many comments, try again later.' };

/** Le jeton tel qu'il arrive : le frein s'exécute AVANT la validation Zod du chemin. */
const shareToken = (req: Request): string => String(req.params.token ?? '');

export const guestCommentRateLimit: RequestHandler[] = [
  rateLimit({
    windowMs: WINDOW_MS,
    max: PER_LINK_MAX,
    message: TOO_MANY,
    name: 'guest-comment-link',
    keyGenerator: (req) => `share:${shareToken(req)}`,
  }),
  rateLimit({
    windowMs: WINDOW_MS,
    max: PER_LINK_AND_IP_MAX,
    message: TOO_MANY,
    name: 'guest-comment-ip',
    keyGenerator: (req) => `share:${shareToken(req)}:${req.ip ?? 'unknown'}`,
  }),
];

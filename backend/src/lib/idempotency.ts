// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createHash } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { prisma } from './prisma';
import { logger } from './logger';

/**
 * Idempotence des écritures v1 (en-tête `Idempotency-Key`).
 *
 * Un script de pipeline qui perd sa connexion pendant un POST ne sait pas si le serveur a
 * traité la requête. Sans filet, le réflexe (rejouer) crée une deuxième version. Avec une
 * clé d'idempotence, le rejeu retrouve la réponse d'origine, à l'identique.
 *
 * La clé est **réservée avant** l'exécution, pas enregistrée après : entre le traitement
 * et l'écriture du résultat, il existe une fenêtre pendant laquelle un rejeu rapide — ou
 * un second worker de la ferme de rendu — passerait au travers et créerait le doublon que
 * l'on cherche précisément à éviter. Pendant cette fenêtre, la réservation répond `409`.
 *
 * L'empreinte inclut la route ET le token : deux clients qui choisiraient la même clé —
 * ou le même client sur deux endpoints — ne peuvent pas se renvoyer la réponse de l'autre.
 */

/** Durée de rétention d'une réponse mémorisée. Au-delà, un rejeu est traité normalement. */
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

/** `statusCode = 0` marque une requête en cours de traitement (réservation). */
const IN_PROGRESS = 0;

export const fingerprint = (key: string, method: string, path: string, tokenId?: number): string =>
  createHash('sha256')
    .update(`${tokenId ?? 'session'} ${method} ${path} ${key}`)
    .digest('hex');

/** En-tête normalisé, borné : une clé est un identifiant, pas un canal de données. */
function readKey(req: Request): string | null {
  const raw = req.headers['idempotency-key'];
  const key = Array.isArray(raw) ? raw[0] : raw;
  if (!key) return null;
  const trimmed = key.trim();
  return trimmed.length > 0 && trimmed.length <= 200 ? trimmed : null;
}

const isExpired = (createdAt: Date): boolean => Date.now() - createdAt.getTime() >= IDEMPOTENCY_TTL_MS;

/**
 * Middleware d'idempotence. Sans en-tête, il ne fait rien : l'idempotence est un contrat
 * que le client demande explicitement.
 */
export async function idempotency(req: Request, res: Response, next: NextFunction): Promise<void> {
  const key = readKey(req);
  if (!key) {
    next();
    return;
  }
  const fp = fingerprint(key, req.method, req.baseUrl + req.path, req.apiToken?.id);

  try {
    await prisma.idempotencyRecord.create({
      data: { fingerprint: fp, statusCode: IN_PROGRESS, response: {} },
    });
  } catch {
    // La clé est déjà prise : soit la réponse est connue, soit elle est en cours.
    const existing = await prisma.idempotencyRecord.findUnique({ where: { fingerprint: fp } });
    if (existing && !isExpired(existing.createdAt)) {
      if (existing.statusCode === IN_PROGRESS) {
        res.status(409).json({
          error: 'Requête identique déjà en cours de traitement',
          code: 'IDEMPOTENCY_IN_PROGRESS',
        });
        return;
      }
      res.setHeader('Idempotency-Replayed', 'true');
      res.status(existing.statusCode).json(existing.response);
      return;
    }
    // Réservation expirée : on la reprend pour ce nouvel essai.
    await prisma.idempotencyRecord
      .update({
        where: { fingerprint: fp },
        data: { statusCode: IN_PROGRESS, response: {}, createdAt: new Date() },
      })
      .catch(() => undefined);
  }

  // Mémorise la réponse au moment de son envoi. Seuls les succès sont retenus : rejouer
  // une erreur transitoire (503 d'un service tiers, conflit résolu depuis) doit pouvoir
  // aboutir, sinon la clé fige un échec pendant 24 h — la réservation est alors levée.
  const originalJson = res.json.bind(res);
  let recorded = false;
  res.json = (body: unknown): Response => {
    recorded = res.statusCode >= 200 && res.statusCode < 300;
    if (!recorded) return originalJson(body);

    // L'envoi est différé le temps d'écrire la réponse. Quelques millisecondes contre une
    // garantie ferme : tout rejeu, même immédiat, retrouve ce corps au lieu de retomber
    // sur « traitement en cours » — ou pire, de repartir pour un second traitement.
    const status = res.statusCode;
    void prisma.idempotencyRecord
      .update({ where: { fingerprint: fp }, data: { statusCode: status, response: body as object } })
      .catch((err) => logger.warn({ err }, '[idempotency] mémorisation impossible'))
      .finally(() => originalJson(body));
    return res;
  };

  // Filet : réponse en erreur, ou terminée sans JSON (204). La réservation doit tomber,
  // sinon un rejeu légitime resterait bloqué en « déjà en cours » jusqu'à expiration.
  res.on('finish', () => {
    if (recorded) return;
    void prisma.idempotencyRecord
      .deleteMany({ where: { fingerprint: fp, statusCode: IN_PROGRESS } })
      .catch(() => undefined);
  });

  next();
}

/** Purge des réponses mémorisées expirées (appelée par le worker de maintenance). */
export async function purgeIdempotencyRecords(now = new Date()): Promise<number> {
  const { count } = await prisma.idempotencyRecord.deleteMany({
    where: { createdAt: { lt: new Date(now.getTime() - IDEMPOTENCY_TTL_MS) } },
  });
  return count;
}

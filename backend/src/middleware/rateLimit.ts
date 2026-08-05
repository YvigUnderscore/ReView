// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Request, Response, NextFunction } from 'express';

/** Longueur maximale d'une clé de comptage (IP + éventuel discriminant de requête). */
const MAX_KEY_LENGTH = 160;
/** Nombre maximal de clés suivies simultanément, toutes fenêtres confondues. */
const MAX_TRACKED_KEYS = 100_000;

interface RateLimitOptions {
  windowMs?: number;
  max?: number;
  message?: Record<string, unknown>;
  keyGenerator?: (req: Request) => string;
}

/**
 * Rate limiter in-memory (suffisant en mono-instance). Porté de utils/rateLimiter.js.
 */
export const rateLimit = (options: RateLimitOptions = {}) => {
  const windowMs = options.windowMs ?? 15 * 60 * 1000;
  const max = options.max ?? 100;
  const message = options.message ?? { error: 'Trop de requêtes, réessayez plus tard.' };
  const keyGenerator = options.keyGenerator ?? ((req: Request) => req.ip ?? 'unknown');

  const hits = new Map<string, { count: number; startTime: number }>();

  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, data] of hits.entries()) {
      if (now - data.startTime > windowMs) hits.delete(key);
    }
  }, 60_000);
  cleanup.unref?.();

  return (req: Request, res: Response, next: NextFunction): void => {
    // La clé peut incorporer une donnée de requête (le token de partage, par exemple) — et
    // certains limiteurs s'exécutent AVANT la validation Zod, la valeur est donc arbitraire
    // et de longueur libre. On la borne, sinon chaque requête forge une entrée nouvelle et
    // la table grossit sans fin (le balayage ne retire qu'au bout d'une fenêtre entière).
    const key = keyGenerator(req).slice(0, MAX_KEY_LENGTH);
    const now = Date.now();

    // Filet de sécurité : au-delà du plafond, on repart d'une table vide plutôt que de
    // laisser la mémoire filer. Un compteur perdu autorise quelques requêtes de plus ;
    // une table sans borne met le service à terre.
    if (hits.size >= MAX_TRACKED_KEYS && !hits.has(key)) hits.clear();
    const data = hits.get(key);

    if (!data || now - data.startTime > windowMs) {
      hits.set(key, { count: 1, startTime: now });
      next();
      return;
    }

    if (data.count >= max) {
      res.status(429).json(message);
      return;
    }

    data.count++;
    next();
  };
};

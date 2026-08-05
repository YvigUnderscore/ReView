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

    // Plafond de la table. ⚠ Surtout PAS un `hits.clear()` : la clé de certains limiteurs
    // incorpore une donnée de requête (`unlock:<ip>:<token>` pour le déverrouillage d'un
    // partage), donc un seul client peut forger autant de clés qu'il veut. Vider la table
    // effacerait AUSSI son propre compteur — le garde-fou mémoire deviendrait une remise à
    // zéro du limiteur, donc un moyen de forcer le mot de passe indéfiniment.
    // On purge donc les fenêtres expirées, et si cela ne suffit pas on refuse la clé
    // nouvelle (échec fermé) : les compteurs déjà établis restent intacts.
    // Le refus est immédiat, sans balayage : purger ici ferait parcourir toute la table à
    // CHAQUE requête une fois le plafond atteint — l'attaquant transformerait le garde-fou
    // en amplificateur quadratique. La récupération de place est laissée au balayage
    // périodique ci-dessus.
    if (hits.size >= MAX_TRACKED_KEYS && !hits.has(key)) {
      res.status(429).json(message);
      return;
    }
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

// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Request, Response, NextFunction } from 'express';

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
    const key = keyGenerator(req);
    const now = Date.now();
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

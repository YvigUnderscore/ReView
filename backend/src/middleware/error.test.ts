// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AppError } from '../lib/errors';
import { errorHandler } from './error';

/** Double de réponse Express : on ne garde que ce que le client verrait. */
function responseSpy() {
  const sent: { status?: number; body?: Record<string, unknown> } = {};
  const res = {
    status(code: number) {
      sent.status = code;
      return this;
    },
    json(body: Record<string, unknown>) {
      sent.body = body;
      return this;
    },
  };
  return { res: res as unknown as Response, sent };
}

/** Requête portant un logger muet — le handler journalise les erreurs non gérées. */
const request = () =>
  ({ log: { error: vi.fn() } }) as unknown as Request & { log: { error: ReturnType<typeof vi.fn> } };

const next = (() => undefined) as NextFunction;

describe('errorHandler', () => {
  it('erreur applicative : statut, message et code du client', () => {
    const { res, sent } = responseSpy();
    errorHandler(new AppError('Project is archived', 403, 'PROJECT_ARCHIVED'), request(), res, next);
    expect(sent.status).toBe(403);
    expect(sent.body).toEqual({ error: 'Project is archived', code: 'PROJECT_ARCHIVED' });
  });

  it('erreur applicative : les détails accompagnent le code', () => {
    const { res, sent } = responseSpy();
    errorHandler(new AppError('Locked', 409, 'SG_LOCKED', { url: 'https://sg/x' }), request(), res, next);
    expect(sent.body).toMatchObject({ code: 'SG_LOCKED', url: 'https://sg/x' });
  });

  it('schéma refusé : 400 avec un code traduisible et les champs fautifs', () => {
    const { res, sent } = responseSpy();
    const parsed = z.object({ email: z.string().email() }).safeParse({ email: 'x' });
    errorHandler(parsed.success ? null : parsed.error, request(), res, next);
    expect(sent.status).toBe(400);
    expect(sent.body).toMatchObject({ error: 'Validation failed', code: 'VALIDATION_FAILED' });
    expect(sent.body?.details).toHaveProperty('email');
  });

  it('erreur non gérée : 500 anonyme, codé, et journalisé', () => {
    const { res, sent } = responseSpy();
    const req = request();
    errorHandler(new Error('secret de la stack'), req, res, next);
    expect(sent.status).toBe(500);
    expect(sent.body).toEqual({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(sent.body)).not.toContain('secret');
    expect(req.log.error).toHaveBeenCalledTimes(1);
  });

  it('les deux réponses fabriquées ici portent un code, comme les erreurs typées', () => {
    // Sans code, les deux fautes les plus fréquentes seraient les seules à rester
    // anglaises dans une interface traduite en quatorze langues.
    for (const err of [
      new Error('x'),
      z.string().safeParse(1).success ? null : z.string().safeParse(1).error,
    ]) {
      const { res, sent } = responseSpy();
      errorHandler(err, request(), res, next);
      expect(sent.body?.code).toBeTruthy();
    }
  });
});

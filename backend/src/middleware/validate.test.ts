// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { validate } from './validate';
import { errorHandler } from './error';

/** A route that echoes what it reads after validation, with the runtime types. */
function appWith(schemas: Parameters<typeof validate>[0]) {
  return express()
    .use(express.json())
    .post('/:id', validate(schemas), (req, res) => {
      const typed = (o: Record<string, unknown>) =>
        Object.fromEntries(Object.entries(o).map(([k, v]) => [k, [v, typeof v]]));
      res.json({ query: typed(req.query), params: typed(req.params), body: req.body as unknown });
    })
    .use(errorHandler);
}

describe('validate', () => {
  it('validates the query, but the route still reads the raw strings (Express 5 getter)', async () => {
    // `req.query` is a getter re-parsing the URL on each read: the coercion does not persist. Routes that
    // need typed values re-read the query through their schema (`routes/v1/helpers#readQuery`).
    const app = appWith({ query: z.object({ limit: z.coerce.number().int().default(25) }) });
    const res = await request(app).post('/1?limit=10&extra=yes');
    expect(res.body.query).toEqual({ limit: ['10', 'string'], extra: ['yes', 'string'] });
  });

  it('coerces params and parses the body', async () => {
    const app = appWith({
      params: z.object({ id: z.coerce.number() }),
      body: z.object({ name: z.string().trim() }),
    });
    const res = await request(app).post('/7').send({ name: '  a  ' });
    expect(res.body.params).toEqual({ id: [7, 'number'] });
    expect(res.body.body).toEqual({ name: 'a' });
  });

  it('a rejected request is a 400 with the offending fields', async () => {
    const app = appWith({ query: z.object({ limit: z.coerce.number().max(100) }) });
    const res = await request(app).post('/1?limit=500');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.details).toHaveProperty('limit');
  });

  it('exposes its schemas for the OpenAPI generator', () => {
    const query = z.object({ q: z.string() });
    expect(validate({ query }).schemas.query).toBe(query);
  });
});

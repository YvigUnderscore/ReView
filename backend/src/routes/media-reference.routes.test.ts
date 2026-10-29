// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

/**
 * The position of a reference image was bounded nowhere, then was bounded to 0..1, which pinned the
 * reference ON the media by default, then to the letterbox bands, which still forbade the sides of a
 * wide shot. It can now be placed anywhere on the viewer's canvas: the schema lets through all the
 * useful overflow and refuses only the aberrant, what no viewer shows and nobody can recover.
 */
const { add, remove } = vi.hoisted(() => ({ add: vi.fn(), remove: vi.fn() }));

vi.mock('../middleware/auth', async () => ({
  ...(await import('../middleware/authUser')),
  authenticate: (req: Request, _res: Response, next: NextFunction) => {
    req.user = { id: 7, email: 'artist@studio.com', role: 'ARTIST' };
    next();
  },
}));
vi.mock('../services/ReviewReferenceService', () => ({ add, remove }));

import express from 'express';
import request from 'supertest';
import referenceRoutes from './media-reference.routes';
import { errorHandler } from '../middleware/error';

const app = express().use(express.json()).use('/api/media', referenceRoutes).use(errorHandler);

const body = (pos: Record<string, number>) => ({
  dataUrl: 'data:image/png;base64,AA',
  commentId: 3,
  ...pos,
});
const post = (pos: Record<string, number>) => request(app).post('/api/media/5/references').send(body(pos));

beforeEach(() => {
  vi.clearAllMocks();
  add.mockResolvedValue({ id: 1, url: 'u', x: 0.1, y: 0.1, width: 0.3, commentId: 3 });
});

describe('POST /api/media/:id/references — position bounded to what is reachable', () => {
  it('accepts a position within the frame', async () => {
    const res = await post({ x: 0.5, y: 0.25, width: 0.3 });
    expect(res.status).toBe(201);
    expect(add).toHaveBeenCalledWith(expect.anything(), 5, 'data:image/png;base64,AA', 3, {
      x: 0.5,
      y: 0.25,
      width: 0.3,
    });
  });

  it('accepts a reference placed BESIDE the media, anywhere on the canvas', async () => {
    expect((await post({ x: 1.05, y: 0.02, width: 0.3 })).status).toBe(201);
    expect((await post({ x: -0.32, y: 0.02, width: 0.3 })).status).toBe(201);
    expect((await post({ x: 2.4, y: -1.8, width: 0.3 })).status).toBe(201);
    expect(add).toHaveBeenCalledTimes(3);
  });

  it('rejects an aberrant position without writing anything', async () => {
    expect((await post({ x: 12, y: 0, width: 0.3 })).status).toBe(400);
    expect((await post({ x: 0.2, y: -8, width: 0.3 })).status).toBe(400);
    expect(add).not.toHaveBeenCalled();
  });

  it('rejects an infinity and a NaN, whatever path they take', async () => {
    // `1e999` is valid JSON that reads back as `Infinity`; `JSON.stringify` of an Infinity or a NaN, for
    // its part, produces `null`. Both would make a `left: NaN%` that displays nothing.
    const raw = (json: string) => request(app).post('/api/media/5/references').type('json').send(json);
    expect((await raw('{"dataUrl":"data:image/png;base64,AA","commentId":3,"x":1e999}')).status).toBe(400);
    expect((await raw('{"dataUrl":"data:image/png;base64,AA","commentId":3,"y":-1e999}')).status).toBe(400);
    expect((await post({ x: Number.NaN, y: 0, width: 0.3 })).status).toBe(400);
    expect(add).not.toHaveBeenCalled();
  });

  it('rejects an out-of-bounds width', async () => {
    expect((await post({ x: 0, y: 0, width: 3 })).status).toBe(400);
    expect((await post({ x: 0, y: 0, width: 0 })).status).toBe(400);
    expect(add).not.toHaveBeenCalled();
  });

  it('accepts a request without a position (the service sets its values)', async () => {
    expect((await post({})).status).toBe(201);
  });
});

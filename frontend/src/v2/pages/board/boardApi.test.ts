// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../lib/apiClient', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
  getToken: () => 'jwt',
}));

import { api } from '../../../lib/apiClient';
import { BoardConflictError, loadBoard, persistBoard, presignBoardFiles, saveBoard } from './boardApi';
import { MAX_INLINE_DATAURL, type BoardFiles } from './boardFiles';

const jsonResponse = (status: number, body: unknown) =>
  ({ ok: status < 400, status, json: () => Promise.resolve(body) }) as unknown as Response;

const realFetch = globalThis.fetch;
beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('loadBoard', () => {
  it('rapatrie les images stockées et rend la scène telle qu’Excalidraw l’attend', async () => {
    vi.mocked(api.get).mockResolvedValue({
      board: {
        document: {
          elements: [{ id: 'a', type: 'rectangle' }],
          files: { f1: { id: 'f1', mimeType: 'image/png' } },
        },
        updatedAt: '2026-08-22T10:00:00.000Z',
      },
      fileUrls: { f1: 'https://minio/get/f1' },
    });
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new TextEncoder().encode('hi').buffer),
    }) as never;

    const loaded = await loadBoard('/api/boards/project/1');
    expect(loaded.updatedAt).toBe('2026-08-22T10:00:00.000Z');
    // Calculé avant réhydratation : le fichier ne doit pas repartir vers MinIO à la sauvegarde.
    expect([...loaded.storedIds]).toEqual(['f1']);
    expect(loaded.files.f1?.dataURL).toMatch(/^data:image\/png;base64,/);
  });

  it('ouvre un board legacy dont les images sont restées en base64', async () => {
    const files = { f1: { id: 'f1', mimeType: 'image/png', dataURL: 'data:image/png;base64,aGk=' } };
    vi.mocked(api.get).mockResolvedValue({ board: { document: { elements: [], files }, updatedAt: null } });
    const loaded = await loadBoard('/api/boards/project/1');
    expect(loaded.files).toEqual(files);
    expect([...loaded.storedIds]).toEqual([]);
  });
});

describe('saveBoard', () => {
  const body = { document: { elements: [], files: {} }, baseUpdatedAt: null };

  it('rend le nouvel horodatage — base de la sauvegarde suivante', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { board: { updatedAt: '2026-08-22T11:00:00.000Z' } })) as never;
    await expect(saveBoard('/api/boards/project/1', body)).resolves.toBe('2026-08-22T11:00:00.000Z');
  });

  it('signale le conflit d’édition avec l’horodatage du serveur', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse(409, {
        error: 'Board changed',
        code: 'BOARD_CONFLICT',
        updatedAt: '2026-08-22T12:00:00.000Z',
      }),
    ) as never;
    const err = await saveBoard('/api/boards/project/1', body).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BoardConflictError);
    expect((err as BoardConflictError).serverUpdatedAt).toBe('2026-08-22T12:00:00.000Z');
  });

  it('repasse par l’apiClient sur 401 : le renouvellement de jeton reste transparent', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse(401, { error: 'expired' })) as never;
    vi.mocked(api.put).mockResolvedValue({ board: { updatedAt: '2026-08-22T13:00:00.000Z' } });
    await expect(saveBoard('/api/boards/project/1', body)).resolves.toBe('2026-08-22T13:00:00.000Z');
    expect(api.put).toHaveBeenCalledWith('/api/boards/project/1', body);
  });

  it('remonte le message du serveur sur les autres erreurs', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse(400, { error: 'Board document too large' })) as never;
    await expect(saveBoard('/api/boards/project/1', body)).rejects.toThrow('Board document too large');
  });
});

describe('presignBoardFiles', () => {
  it('découpe la demande en lots de 20 — le plafond du serveur', async () => {
    vi.mocked(api.post).mockImplementation((_path: string, payload?: unknown) =>
      Promise.resolve({
        uploads: (payload as { files: { id: string }[] }).files.map((f) => ({
          id: f.id,
          url: `https://minio/put/${f.id}`,
        })),
      }),
    );
    const files = Array.from({ length: 25 }, (_, i) => ({ id: `f${i}`, mimeType: 'image/png' }));
    const out = await presignBoardFiles('/api/boards/project/1', files);
    expect(api.post).toHaveBeenCalledTimes(2);
    expect(out).toHaveLength(25);
  });
});

describe('persistBoard', () => {
  const heavy = `data:image/png;base64,${'A'.repeat(MAX_INLINE_DATAURL)}`;

  it('dépose l’image dans MinIO puis n’envoie que sa clé dans le document', async () => {
    vi.mocked(api.post).mockResolvedValue({ uploads: [{ id: 'big', url: 'https://minio/put/big' }] });
    const put = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'PUT' && url.startsWith('https://minio')) return put(url, init);
      return Promise.resolve(jsonResponse(200, { board: { updatedAt: '2026-08-22T11:00:00.000Z' } }));
    }) as never;

    const files: BoardFiles = { big: { id: 'big', mimeType: 'image/png', dataURL: heavy } };
    const stored = new Set<string>();
    const at = await persistBoard('/api/boards/project/1', { elements: [], files }, stored, null);

    expect(at).toBe('2026-08-22T11:00:00.000Z');
    expect(put).toHaveBeenCalledTimes(1);
    expect([...stored]).toEqual(['big']);
    const saved = JSON.parse(
      (vi.mocked(globalThis.fetch).mock.calls.at(-1)![1] as RequestInit).body as string,
    );
    expect(saved.document.files.big).toEqual({ id: 'big', mimeType: 'image/png' });
    expect(JSON.stringify(saved)).not.toContain('AAAA');
  });

  it('ne redépose pas une image déjà stockée', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { board: { updatedAt: '2026-08-22T11:00:00.000Z' } })) as never;
    const files: BoardFiles = { big: { id: 'big', mimeType: 'image/png', dataURL: heavy } };
    await persistBoard('/api/boards/project/1', { elements: [], files }, new Set(['big']), null);
    expect(api.post).not.toHaveBeenCalled();
  });
});

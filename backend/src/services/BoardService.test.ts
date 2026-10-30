// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/prisma', () => ({
  prisma: {
    board: { findUnique: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
  },
}));

vi.mock('../lib/storage', () => ({
  storage: {
    getPresignedGetUrl: vi.fn((key: string) => Promise.resolve(`https://minio/get/${key}`)),
    getPresignedPutUrl: vi.fn((key: string) => Promise.resolve(`https://minio/put/${key}`)),
    forgetPresignedUrl: vi.fn(),
  },
}));

import { AppError } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { storage } from '../lib/storage';
import {
  MAX_DOCUMENT_BYTES,
  MAX_ELEMENTS,
  MAX_INLINE_DATAURL,
  boardDocumentSchema,
  boardFileKey,
  boardPrefix,
  presignBoardFiles,
  readBoard,
  writeBoard,
} from './BoardService';

const rect = (id: string) => ({ id, type: 'rectangle', x: 0, y: 0, width: 10, height: 10 });
const storedFile = (id: string) => ({ id, mimeType: 'image/png', created: 1 });

beforeEach(() => vi.clearAllMocks());

/**
 * The document used to be `z.any()`: any body under 2 MB was accepted, and pasted images travelled
 * through it as base64 until a 413.
 */
describe('boardDocumentSchema: document bounds', () => {
  it('accepts a normal document and fills in the default values', () => {
    expect(boardDocumentSchema.parse({})).toEqual({ elements: [], files: {} });
    const doc = boardDocumentSchema.parse({ elements: [rect('a')], files: { f1: storedFile('f1') } });
    expect(doc.elements).toHaveLength(1);
    expect(doc.files.f1?.mimeType).toBe('image/png');
  });

  it('lets unknown Excalidraw attributes of an element through', () => {
    const doc = boardDocumentSchema.parse({
      elements: [{ ...rect('a'), roundness: { type: 3 }, boundElements: null }],
    });
    expect(doc.elements[0]).toMatchObject({ roundness: { type: 3 } });
  });

  it('refuses an unknown key at the root of the document', () => {
    expect(boardDocumentSchema.safeParse({ elements: [], files: {}, appState: {} }).success).toBe(false);
  });

  it('refuses a dataURL above the inline ceiling', () => {
    const big = { id: 'f1', mimeType: 'image/png', dataURL: 'd'.repeat(MAX_INLINE_DATAURL + 1) };
    expect(boardDocumentSchema.safeParse({ elements: [], files: { f1: big } }).success).toBe(false);
  });

  it('accepts a small inline dataURL (SVG, icon) as is', () => {
    const svg = {
      id: 'f1',
      mimeType: 'image/svg+xml',
      dataURL: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
    };
    const doc = boardDocumentSchema.parse({ elements: [], files: { f1: svg } });
    expect(doc.files.f1?.dataURL).toBe(svg.dataURL);
  });

  it('refuses an externalised file whose type is not an image', () => {
    const bad = { id: 'f1', mimeType: 'text/html' };
    const res = boardDocumentSchema.safeParse({ elements: [], files: { f1: bad } });
    expect(res.success).toBe(false);
  });

  it('accepts an externalised SVG: it is stored opaque and re-displayed as a dataURL', () => {
    const doc = boardDocumentSchema.parse({
      elements: [],
      files: { f1: { id: 'f1', mimeType: 'image/svg+xml' } },
    });
    expect(doc.files.f1?.mimeType).toBe('image/svg+xml');
  });

  it('refuses a file identifier outside the allow-list (path traversal)', () => {
    const res = boardDocumentSchema.safeParse({
      elements: [],
      files: { '../../secret': { id: '../../secret', mimeType: 'image/png' } },
    });
    expect(res.success).toBe(false);
  });

  it('refuses an entry whose id does not match its key', () => {
    const res = boardDocumentSchema.safeParse({
      elements: [],
      files: { f1: { id: 'f2', mimeType: 'image/png' } },
    });
    expect(res.success).toBe(false);
  });

  it('refuses a document above the element ceiling', () => {
    const elements = Array.from({ length: MAX_ELEMENTS + 1 }, (_, i) => rect(`e${i}`));
    expect(boardDocumentSchema.safeParse({ elements }).success).toBe(false);
  });

  it('refuses an oversized document, with a message that says what to do', () => {
    // A single element, but weighted down by a giant attribute: it is the serialized size that counts.
    const fat = { ...rect('a'), notes: 'x'.repeat(MAX_DOCUMENT_BYTES) };
    const res = boardDocumentSchema.safeParse({ elements: [fat] });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error.issues[0]?.message).toContain('too large');
  });
});

describe('storage keys', () => {
  it('derives the key from the scope and the id, never received from the client', () => {
    expect(boardPrefix(7, { projectId: 7 })).toBe('projects/7/boards/project/');
    expect(boardFileKey(9, { assetId: 3 }, 'abc123')).toBe('projects/9/boards/asset/3/abc123');
  });

  it('refuses a forged file id', () => {
    expect(() => boardFileKey(7, { projectId: 7 }, '../../avatars/1')).toThrow(AppError);
    expect(() => boardFileKey(7, { projectId: 7 }, '.hidden')).toThrow(AppError);
  });

  it('tolerates a dotted id: an imported board brings some, never a separator', () => {
    expect(boardFileKey(7, { projectId: 7 }, 'logo.v2')).toBe('projects/7/boards/project/logo.v2');
  });
});

describe('readBoard', () => {
  it('signs a read URL per externalised file, forcing the response type', async () => {
    vi.mocked(prisma.board.findUnique).mockResolvedValue({
      id: 1,
      projectId: 7,
      assetId: null,
      document: { elements: [], files: { f1: storedFile('f1') } },
      updatedAt: new Date('2026-08-22T10:00:00.000Z'),
    });
    const out = await readBoard(7, { projectId: 7 });
    expect(out.fileUrls).toEqual({ f1: 'https://minio/get/projects/7/boards/project/f1' });
    expect(storage.getPresignedGetUrl).toHaveBeenCalledWith(
      'projects/7/boards/project/f1',
      3600,
      'image/png',
    );
  });

  it('reads back a legacy board (base64 images) without signing or modifying anything', async () => {
    const legacy = {
      elements: [rect('a')],
      files: { f1: { id: 'f1', mimeType: 'image/png', dataURL: 'data:…' } },
    };
    vi.mocked(prisma.board.findUnique).mockResolvedValue({
      id: 1,
      projectId: 7,
      assetId: null,
      document: legacy,
      updatedAt: new Date(),
    });
    const out = await readBoard(7, { projectId: 7 });
    expect(out.board.document).toEqual(legacy);
    expect(out.fileUrls).toEqual({});
    expect(storage.getPresignedGetUrl).not.toHaveBeenCalled();
  });

  it('returns an empty board when it does not exist yet', async () => {
    vi.mocked(prisma.board.findUnique).mockResolvedValue(null);
    const out = await readBoard(9, { assetId: 5 });
    expect(out.board).toEqual({ assetId: 5, document: {}, updatedAt: null });
  });
});

describe('writeBoard: concurrency control', () => {
  const doc = boardDocumentSchema.parse({ elements: [rect('a')] });

  it('creates the board when the editor loaded it as nonexistent', async () => {
    vi.mocked(prisma.board.create).mockResolvedValue({ id: 1, updatedAt: new Date() } as never);
    await writeBoard({ projectId: 7 }, doc, null);
    expect(prisma.board.create).toHaveBeenCalledWith({
      data: { projectId: 7, document: doc },
    });
  });

  it('409 if the board was created in the meantime by someone else', async () => {
    vi.mocked(prisma.board.create).mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }));
    const now = new Date('2026-08-22T11:00:00.000Z');
    vi.mocked(prisma.board.findUnique).mockResolvedValue({ updatedAt: now } as never);
    await expect(writeBoard({ projectId: 7 }, doc, null)).rejects.toMatchObject({
      statusCode: 409,
      code: 'BOARD_CONFLICT',
      details: { updatedAt: now.toISOString() },
    });
  });

  it('does not turn a database outage into a conflict', async () => {
    vi.mocked(prisma.board.create).mockRejectedValue(new Error('connection refused'));
    await expect(writeBoard({ projectId: 7 }, doc, null)).rejects.toThrow('connection refused');
  });

  it('writes conditionally on updatedAt: the condition is evaluated by the database', async () => {
    const base = '2026-08-22T10:00:00.000Z';
    vi.mocked(prisma.board.updateMany).mockResolvedValue({ count: 1 });
    vi.mocked(prisma.board.findUnique).mockResolvedValue({ id: 1, updatedAt: new Date() } as never);
    await writeBoard({ projectId: 7 }, doc, base);
    expect(prisma.board.updateMany).toHaveBeenCalledWith({
      where: { projectId: 7, updatedAt: new Date(base) },
      data: { document: doc },
    });
  });

  it('409 with the current updatedAt when someone saved in the meantime', async () => {
    const server = new Date('2026-08-22T12:34:56.000Z');
    vi.mocked(prisma.board.updateMany).mockResolvedValue({ count: 0 });
    vi.mocked(prisma.board.findUnique).mockResolvedValue({ updatedAt: server } as never);
    await expect(writeBoard({ projectId: 7 }, doc, '2026-08-22T10:00:00.000Z')).rejects.toMatchObject({
      statusCode: 409,
      code: 'BOARD_CONFLICT',
      details: { updatedAt: server.toISOString() },
    });
  });
});

describe('presignBoardFiles', () => {
  it('returns one upload URL per file, under the derived key', async () => {
    const out = await presignBoardFiles(7, { projectId: 7 }, [{ id: 'f1', mimeType: 'image/jpeg' }]);
    expect(out).toEqual([{ id: 'f1', url: 'https://minio/put/projects/7/boards/project/f1' }]);
    expect(storage.getPresignedPutUrl).toHaveBeenCalledWith(
      'projects/7/boards/project/f1',
      'image/jpeg',
      900,
    );
    expect(storage.forgetPresignedUrl).toHaveBeenCalledWith('projects/7/boards/project/f1');
  });

  it('refuses a type that is not an image', async () => {
    await expect(
      presignBoardFiles(7, { projectId: 7 }, [{ id: 'f1', mimeType: 'text/html' }]),
    ).rejects.toMatchObject({ statusCode: 400, code: 'BAD_CONTENT_TYPE' });
  });
});

// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/prisma', () => ({
  prisma: {
    board: { findUnique: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
  },
}));

vi.mock('./StorageService', () => ({
  storage: {
    getPresignedGetUrl: vi.fn((key: string) => Promise.resolve(`https://minio/get/${key}`)),
    getPresignedPutUrl: vi.fn((key: string) => Promise.resolve(`https://minio/put/${key}`)),
    forgetPresignedUrl: vi.fn(),
  },
}));

import { AppError } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { storage } from './StorageService';
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
 * Le document valait `z.any()` : n'importe quel corps sous 2 Mo était accepté, et les
 * images collées y voyageaient en base64 jusqu'au 413.
 */
describe('boardDocumentSchema — bornes du document', () => {
  it('accepte un document normal et remplit les valeurs par défaut', () => {
    expect(boardDocumentSchema.parse({})).toEqual({ elements: [], files: {} });
    const doc = boardDocumentSchema.parse({ elements: [rect('a')], files: { f1: storedFile('f1') } });
    expect(doc.elements).toHaveLength(1);
    expect(doc.files.f1?.mimeType).toBe('image/png');
  });

  it('laisse passer les attributs Excalidraw inconnus d’un élément', () => {
    const doc = boardDocumentSchema.parse({
      elements: [{ ...rect('a'), roundness: { type: 3 }, boundElements: null }],
    });
    expect(doc.elements[0]).toMatchObject({ roundness: { type: 3 } });
  });

  it('refuse une clé inconnue à la racine du document', () => {
    expect(boardDocumentSchema.safeParse({ elements: [], files: {}, appState: {} }).success).toBe(false);
  });

  it('refuse une dataURL au-delà du plafond inline', () => {
    const big = { id: 'f1', mimeType: 'image/png', dataURL: 'd'.repeat(MAX_INLINE_DATAURL + 1) };
    expect(boardDocumentSchema.safeParse({ elements: [], files: { f1: big } }).success).toBe(false);
  });

  it('accepte une petite dataURL inline (SVG, icône) telle quelle', () => {
    const svg = {
      id: 'f1',
      mimeType: 'image/svg+xml',
      dataURL: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
    };
    const doc = boardDocumentSchema.parse({ elements: [], files: { f1: svg } });
    expect(doc.files.f1?.dataURL).toBe(svg.dataURL);
  });

  it('refuse un fichier externalisé dont le type n’est pas une image', () => {
    const bad = { id: 'f1', mimeType: 'text/html' };
    const res = boardDocumentSchema.safeParse({ elements: [], files: { f1: bad } });
    expect(res.success).toBe(false);
  });

  it('accepte un SVG externalisé — il est stocké opaque et réaffiché en dataURL', () => {
    const doc = boardDocumentSchema.parse({
      elements: [],
      files: { f1: { id: 'f1', mimeType: 'image/svg+xml' } },
    });
    expect(doc.files.f1?.mimeType).toBe('image/svg+xml');
  });

  it('refuse un identifiant de fichier hors liste blanche (traversée de chemin)', () => {
    const res = boardDocumentSchema.safeParse({
      elements: [],
      files: { '../../secret': { id: '../../secret', mimeType: 'image/png' } },
    });
    expect(res.success).toBe(false);
  });

  it('refuse une entrée dont l’id ne correspond pas à sa clé', () => {
    const res = boardDocumentSchema.safeParse({
      elements: [],
      files: { f1: { id: 'f2', mimeType: 'image/png' } },
    });
    expect(res.success).toBe(false);
  });

  it('refuse un document au-delà du plafond d’éléments', () => {
    const elements = Array.from({ length: MAX_ELEMENTS + 1 }, (_, i) => rect(`e${i}`));
    expect(boardDocumentSchema.safeParse({ elements }).success).toBe(false);
  });

  it('refuse un document trop lourd, avec un message qui dit quoi faire', () => {
    // Un seul élément, mais lesté d'un attribut géant : c'est la taille sérialisée qui compte.
    const fat = { ...rect('a'), notes: 'x'.repeat(MAX_DOCUMENT_BYTES) };
    const res = boardDocumentSchema.safeParse({ elements: [fat] });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error.issues[0]?.message).toContain('too large');
  });
});

describe('clés de stockage', () => {
  it('dérive la clé du scope et de l’id — jamais reçue du client', () => {
    expect(boardPrefix(7, { projectId: 7 })).toBe('projects/7/boards/project/');
    expect(boardFileKey(9, { assetId: 3 }, 'abc123')).toBe('projects/9/boards/asset/3/abc123');
  });

  it('refuse un id de fichier fabriqué', () => {
    expect(() => boardFileKey(7, { projectId: 7 }, '../../avatars/1')).toThrow(AppError);
    expect(() => boardFileKey(7, { projectId: 7 }, '.hidden')).toThrow(AppError);
  });

  it('tolère un id pointé — un board importé en apporte, sans jamais de séparateur', () => {
    expect(boardFileKey(7, { projectId: 7 }, 'logo.v2')).toBe('projects/7/boards/project/logo.v2');
  });
});

describe('readBoard', () => {
  it('signe une URL de lecture par fichier externalisé, en imposant le type de la réponse', async () => {
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

  it('relit un board legacy (images en base64) sans rien signer ni modifier', async () => {
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

  it('rend un board vide quand il n’existe pas encore', async () => {
    vi.mocked(prisma.board.findUnique).mockResolvedValue(null);
    const out = await readBoard(9, { assetId: 5 });
    expect(out.board).toEqual({ assetId: 5, document: {}, updatedAt: null });
  });
});

describe('writeBoard — contrôle de concurrence', () => {
  const doc = boardDocumentSchema.parse({ elements: [rect('a')] });

  it('crée le board quand l’éditeur l’a chargé inexistant', async () => {
    vi.mocked(prisma.board.create).mockResolvedValue({ id: 1, updatedAt: new Date() } as never);
    await writeBoard({ projectId: 7 }, doc, null);
    expect(prisma.board.create).toHaveBeenCalledWith({
      data: { projectId: 7, document: doc },
    });
  });

  it('409 si le board a été créé entre-temps par quelqu’un d’autre', async () => {
    vi.mocked(prisma.board.create).mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }));
    const now = new Date('2026-08-22T11:00:00.000Z');
    vi.mocked(prisma.board.findUnique).mockResolvedValue({ updatedAt: now } as never);
    await expect(writeBoard({ projectId: 7 }, doc, null)).rejects.toMatchObject({
      statusCode: 409,
      code: 'BOARD_CONFLICT',
      details: { updatedAt: now.toISOString() },
    });
  });

  it('ne transforme pas une panne base en conflit', async () => {
    vi.mocked(prisma.board.create).mockRejectedValue(new Error('connection refused'));
    await expect(writeBoard({ projectId: 7 }, doc, null)).rejects.toThrow('connection refused');
  });

  it('écrit sous condition d’updatedAt — la condition est évaluée par la base', async () => {
    const base = '2026-08-22T10:00:00.000Z';
    vi.mocked(prisma.board.updateMany).mockResolvedValue({ count: 1 });
    vi.mocked(prisma.board.findUnique).mockResolvedValue({ id: 1, updatedAt: new Date() } as never);
    await writeBoard({ projectId: 7 }, doc, base);
    expect(prisma.board.updateMany).toHaveBeenCalledWith({
      where: { projectId: 7, updatedAt: new Date(base) },
      data: { document: doc },
    });
  });

  it('409 avec l’updatedAt courant quand quelqu’un a sauvegardé entre-temps', async () => {
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
  it('rend une URL de dépôt par fichier, sous la clé dérivée', async () => {
    const out = await presignBoardFiles(7, { projectId: 7 }, [{ id: 'f1', mimeType: 'image/jpeg' }]);
    expect(out).toEqual([{ id: 'f1', url: 'https://minio/put/projects/7/boards/project/f1' }]);
    expect(storage.getPresignedPutUrl).toHaveBeenCalledWith(
      'projects/7/boards/project/f1',
      'image/jpeg',
      900,
    );
    expect(storage.forgetPresignedUrl).toHaveBeenCalledWith('projects/7/boards/project/f1');
  });

  it('refuse un type qui n’est pas une image', async () => {
    await expect(
      presignBoardFiles(7, { projectId: 7 }, [{ id: 'f1', mimeType: 'text/html' }]),
    ).rejects.toMatchObject({ statusCode: 400, code: 'BAD_CONTENT_TYPE' });
  });
});

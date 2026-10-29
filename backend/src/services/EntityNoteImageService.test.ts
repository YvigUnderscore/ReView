// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Role } from '@prisma/client';

vi.mock('./StorageService', () => ({
  storage: {
    getPresignedGetUrl: vi.fn(async (key: string) => `https://minio/${key}?sig`),
    getPresignedPutUrl: vi.fn(async (key: string) => `https://minio/${key}?put`),
  },
}));
vi.mock('./EntityNoteService', async () => {
  const actual = await vi.importActual<typeof import('./EntityNoteService')>('./EntityNoteService');
  return { ...actual, resolveProject: vi.fn() };
});
vi.mock('../middleware/rbac', () => ({ checkProjectAccess: vi.fn() }));

import { checkProjectAccess } from '../middleware/rbac';
import { resolveProject } from './EntityNoteService';
import { buildNoteImageKey, parseNoteImageKey, presign, resolveMany } from './EntityNoteImageService';

const VIEWER = { id: 7, role: Role.ARTIST };

beforeEach(() => {
  vi.mocked(resolveProject).mockReset();
  vi.mocked(checkProjectAccess).mockReset();
});

/**
 * The key of a sheet image is the only thing that decides access: it is therefore read strictly, and anything
 * that deviates is refused rather than interpreted.
 */
describe('parseNoteImageKey', () => {
  it('reads the type and the identifier of the carrying entity', () => {
    expect(parseNoteImageKey('note-images/shot/12/1700-planche.png')).toEqual({ kind: 'shot', id: 12 });
  });

  it('refuses a path traversal', () => {
    expect(parseNoteImageKey('note-images/shot/12/../../avatars/1.png')).toBeNull();
  });

  it('refuses an unknown type and an identifier that is not one', () => {
    expect(parseNoteImageKey('note-images/media/12/a.png')).toBeNull();
    expect(parseNoteImageKey('note-images/shot/douze/a.png')).toBeNull();
  });

  it('refuses one sub-folder too many — the convention has none', () => {
    expect(parseNoteImageKey('note-images/shot/12/sous/a.png')).toBeNull();
  });

  it('ignores what is not a sheet image', () => {
    expect(parseNoteImageKey('comments/attachments/9/note.webm')).toBeNull();
    expect(parseNoteImageKey('https://ailleurs.test/a.jpg')).toBeNull();
  });
});

describe('buildNoteImageKey', () => {
  it('files the image under its entity and enforces the extension of the declared type', () => {
    const key = buildNoteImageKey('asset', 3, 'Planche Finale.PNG', 'image/png');
    expect(key).toMatch(/^note-images\/asset\/3\/\d+-Planche_Finale\.png$/);
  });

  it('refuses a type the browser will not display', () => {
    expect(() => buildNoteImageKey('shot', 1, 'x.psd', 'image/vnd.adobe.photoshop')).toThrow();
  });
});

describe('presign', () => {
  it('returns the upload URL and the read URL — the image must display right away', async () => {
    const out = await presign('shot', 12, 'ref.png', 'image/png');
    expect(out.key).toContain('note-images/shot/12/');
    expect(out.url).toContain('?put');
    expect(out.readUrl).toContain('?sig');
  });
});

describe('resolveMany', () => {
  it("returns the URL only if the entity's project is accessible", async () => {
    vi.mocked(resolveProject).mockResolvedValue(42);
    vi.mocked(checkProjectAccess).mockResolvedValue(false);

    const urls = await resolveMany(VIEWER, ['note-images/shot/12/a.png']);

    expect(urls).toEqual({});
  });

  it('checks membership only once per entity, whatever the number of images', async () => {
    vi.mocked(resolveProject).mockResolvedValue(42);
    vi.mocked(checkProjectAccess).mockResolvedValue(true);

    const urls = await resolveMany(VIEWER, [
      'note-images/shot/12/a.png',
      'note-images/shot/12/b.png',
      'note-images/shot/12/a.png',
    ]);

    expect(Object.keys(urls)).toHaveLength(2);
    expect(vi.mocked(checkProjectAccess)).toHaveBeenCalledTimes(1);
  });

  it('ignores the image of a vanished entity without taking the rest of the sheet with it', async () => {
    vi.mocked(checkProjectAccess).mockResolvedValue(true);
    vi.mocked(resolveProject).mockImplementation(async (_kind, id) => {
      if (id === 999) throw new Error('Entity not found');
      return 42;
    });

    const urls = await resolveMany(VIEWER, ['note-images/shot/999/perdue.png', 'note-images/shot/12/a.png']);

    expect(urls).toEqual({ 'note-images/shot/12/a.png': expect.any(String) });
  });

  it('lets through an old sheet still pointing outside', async () => {
    vi.mocked(resolveProject).mockResolvedValue(42);
    vi.mocked(checkProjectAccess).mockResolvedValue(true);

    const urls = await resolveMany(VIEWER, ['https://ailleurs.test/a.jpg']);

    expect(urls).toEqual({});
    expect(vi.mocked(resolveProject)).not.toHaveBeenCalled();
  });
});

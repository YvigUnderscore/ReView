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
 * La clé d'une image de fiche est la seule chose qui décide de l'accès : elle est donc lue
 * strictement, et tout ce qui s'en écarte est refusé plutôt qu'interprété.
 */
describe('parseNoteImageKey', () => {
  it('lit le type et l’identifiant de l’entité porteuse', () => {
    expect(parseNoteImageKey('note-images/shot/12/1700-planche.png')).toEqual({ kind: 'shot', id: 12 });
  });

  it('refuse une remontée de chemin', () => {
    expect(parseNoteImageKey('note-images/shot/12/../../avatars/1.png')).toBeNull();
  });

  it('refuse un type inconnu et un identifiant qui n’en est pas un', () => {
    expect(parseNoteImageKey('note-images/media/12/a.png')).toBeNull();
    expect(parseNoteImageKey('note-images/shot/douze/a.png')).toBeNull();
  });

  it('refuse un sous-dossier de plus — la convention n’en a pas', () => {
    expect(parseNoteImageKey('note-images/shot/12/sous/a.png')).toBeNull();
  });

  it('ignore ce qui n’est pas une image de fiche', () => {
    expect(parseNoteImageKey('comments/attachments/9/note.webm')).toBeNull();
    expect(parseNoteImageKey('https://ailleurs.test/a.jpg')).toBeNull();
  });
});

describe('buildNoteImageKey', () => {
  it('range l’image sous son entité et impose l’extension du type déclaré', () => {
    const key = buildNoteImageKey('asset', 3, 'Planche Finale.PNG', 'image/png');
    expect(key).toMatch(/^note-images\/asset\/3\/\d+-Planche_Finale\.png$/);
  });

  it('refuse un type que le navigateur n’affichera pas', () => {
    expect(() => buildNoteImageKey('shot', 1, 'x.psd', 'image/vnd.adobe.photoshop')).toThrow();
  });
});

describe('presign', () => {
  it('rend l’URL de dépôt et celle de lecture — l’image doit s’afficher aussitôt', async () => {
    const out = await presign('shot', 12, 'ref.png', 'image/png');
    expect(out.key).toContain('note-images/shot/12/');
    expect(out.url).toContain('?put');
    expect(out.readUrl).toContain('?sig');
  });
});

describe('resolveMany', () => {
  it('ne rend l’URL que si le projet de l’entité est accessible', async () => {
    vi.mocked(resolveProject).mockResolvedValue(42);
    vi.mocked(checkProjectAccess).mockResolvedValue(false);

    const urls = await resolveMany(VIEWER, ['note-images/shot/12/a.png']);

    expect(urls).toEqual({});
  });

  it('ne vérifie l’appartenance qu’une fois par entité, quel que soit le nombre d’images', async () => {
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

  it('ignore l’image d’une entité disparue sans emporter le reste de la planche', async () => {
    vi.mocked(checkProjectAccess).mockResolvedValue(true);
    vi.mocked(resolveProject).mockImplementation(async (_kind, id) => {
      if (id === 999) throw new Error('Entity not found');
      return 42;
    });

    const urls = await resolveMany(VIEWER, ['note-images/shot/999/perdue.png', 'note-images/shot/12/a.png']);

    expect(urls).toEqual({ 'note-images/shot/12/a.png': expect.any(String) });
  });

  it('laisse passer une fiche ancienne qui pointe encore vers l’extérieur', async () => {
    vi.mocked(resolveProject).mockResolvedValue(42);
    vi.mocked(checkProjectAccess).mockResolvedValue(true);

    const urls = await resolveMany(VIEWER, ['https://ailleurs.test/a.jpg']);

    expect(urls).toEqual({});
    expect(vi.mocked(resolveProject)).not.toHaveBeenCalled();
  });
});

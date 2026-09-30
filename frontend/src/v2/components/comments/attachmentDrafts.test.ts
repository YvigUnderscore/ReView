// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import type { CommentAttachment } from '../../../lib/commentAttachments';
import { fileIndexOf, imageDrafts, removeDraft, toDrafts } from './attachmentDrafts';

const png = (name: string) => new File(['x'], name, { type: 'image/png' });
const stored = (key: string, patch: Partial<CommentAttachment> = {}): CommentAttachment => ({
  key,
  name: 'stockee.png',
  contentType: 'image/png',
  url: 'https://minio/signed',
  ...patch,
});

describe('toDrafts — un seul lot affichable', () => {
  it("met l'existant d'abord, puis les fichiers en attente", () => {
    const drafts = toDrafts([stored('k1')], [png('a.png'), png('b.png')], ['blob:a', 'blob:b']);
    expect(drafts.map((d) => d.id)).toEqual(['k1', 'file:0', 'file:1']);
    expect(drafts.map((d) => d.name)).toEqual(['stockee.png', 'a.png', 'b.png']);
    expect(drafts.map((d) => d.url)).toEqual(['https://minio/signed', 'blob:a', 'blob:b']);
  });

  /** Les URL `blob:` arrivent au rendu suivant : la vignette doit tolérer leur absence. */
  it('accepte une liste de vignettes encore vide', () => {
    expect(toDrafts([], [png('a.png')], [])[0].url).toBeNull();
  });
});

describe('fileIndexOf / removeDraft — retirer avant envoi', () => {
  it("distingue un fichier local d'une pièce déjà stockée", () => {
    expect(fileIndexOf('file:2')).toBe(2);
    expect(fileIndexOf('comments/attachments/5/1-a.png')).toBeNull();
    expect(fileIndexOf('file:abc')).toBeNull();
  });

  it('retire le fichier désigné sans toucher aux autres', () => {
    const files = [png('a.png'), png('b.png'), png('c.png')];
    expect(removeDraft('file:1', files, []).files.map((f) => f.name)).toEqual(['a.png', 'c.png']);
  });

  it('retire une pièce déjà stockée par sa clé, en laissant les fichiers', () => {
    const next = removeDraft('k1', [png('a.png')], [stored('k1'), stored('k2')]);
    expect(next.existing.map((a) => a.key)).toEqual(['k2']);
    expect(next.files).toHaveLength(1);
  });

  it('ne mute jamais les listes reçues', () => {
    const files = [png('a.png')];
    const existing = [stored('k1')];
    removeDraft('file:0', files, existing);
    expect(files).toHaveLength(1);
    expect(existing).toHaveLength(1);
  });
});

describe('imageDrafts — ce qui entre au carrousel', () => {
  it("ne garde que les images pourvues d'une URL", () => {
    const drafts = toDrafts(
      [stored('k1'), stored('k2', { contentType: 'application/pdf' }), stored('k3', { url: null })],
      [],
      [],
    );
    expect(imageDrafts(drafts).map((d) => d.id)).toEqual(['k1']);
  });
});

// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { comment, version, links, storage, annotationToSvg } = vi.hoisted(() => ({
  comment: { findUnique: vi.fn() },
  version: { findUnique: vi.fn() },
  links: { mapSgToLocal: vi.fn(), upsertLink: vi.fn(), findByLocal: vi.fn() },
  // Le stockage est ici la doublure qui compte : c'est lui qu'interrogeait la branche
  // morte (`Comment.screenshotKey`). Il doit rester muet.
  storage: { getObjectBuffer: vi.fn(), downloadToFile: vi.fn() },
  annotationToSvg: vi.fn(() => null),
}));

vi.mock('../../lib/prisma', () => ({ prisma: { comment, version } }));
vi.mock('../../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../lib/annotationSvg', () => ({ annotationToSvg }));
vi.mock('../../config/env', () => ({ env: { APP_URL: null } }));
vi.mock('../MediaService', () => ({ mediaSourceKey: vi.fn(() => 'key') }));
vi.mock('../StorageService', () => ({ storage }));
vi.mock('./ShotgridNoteAttachments', () => ({ importNoteAttachments: vi.fn(async () => 0) }));
vi.mock('./ShotgridPullService', () => ({ touch: vi.fn() }));
vi.mock('./shotgridSettings', () => ({ can: () => true }));
vi.mock('./shotgridLinks', () => ({
  mapSgToLocal: (...args: unknown[]) => links.mapSgToLocal(...args),
  upsertLink: (...args: unknown[]) => links.upsertLink(...args),
  findByLocal: (...args: unknown[]) => links.findByLocal(...args),
}));

import { pushComment } from './ShotgridNoteSync';

function context(attachAnnotations: boolean) {
  const createAs = vi.fn(async () => ({ id: 4242, type: 'Note' }));
  const uploadFile = vi.fn(async () => undefined);
  return {
    ctx: {
      connectionId: 1,
      sgProjectId: 77,
      client: { createAs, uploadFile },
      attachAnnotations,
      asUserLogin: null,
    },
    createAs,
    uploadFile,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  comment.findUnique.mockResolvedValue({
    id: 12,
    content: '<p>Le raccord saute</p>',
    timestamp: 4,
    annotation: { strokes: [] },
    author: { name: 'Léa', email: 'lea@studio.fr' },
    media: {
      id: 71,
      versionId: 31,
      metadata: { frameRate: 25 },
      storageKey: 'k',
      mimeType: 'video/mp4',
    },
  });
  version.findUnique.mockResolvedValue({ name: 'sh010_v003' });
  links.findByLocal.mockImplementation(async (_c: number, type: string) =>
    type === 'version' ? { sgId: 900 } : null,
  );
  links.upsertLink.mockResolvedValue(undefined);
});

describe('pushComment — pièce jointe de la frame annotée', () => {
  it('ne joint rien quand l’annotation ne donne aucune image', async () => {
    // `Comment.screenshotKey` était lue en priorité pour joindre une capture déjà
    // calculée — mais rien dans le dépôt n'a jamais écrit cette colonne : la branche
    // était morte et le repli, l'unique chemin. La colonne et sa lecture sont parties
    // ensemble ; la composition de la frame est donc la SEULE source possible.
    // Sans SVG à incruster, il n'y a pas d'image, donc pas de pièce jointe.
    const { ctx, uploadFile } = context(true);
    annotationToSvg.mockReturnValue(null);

    await expect(pushComment(ctx as never, 12)).resolves.toBe(4242);

    expect(uploadFile).not.toHaveBeenCalled();
    // Aucune capture n'est cherchée dans MinIO : plus personne ne lit de clé de capture.
    expect(storage.getObjectBuffer).not.toHaveBeenCalled();
    expect(storage.downloadToFile).not.toHaveBeenCalled();
  });

  it('pose la correspondance du commentaire sur la Note créée', async () => {
    const { ctx, createAs } = context(false);

    await pushComment(ctx, 12);

    expect(createAs).toHaveBeenCalledTimes(1);
    expect(links.upsertLink).toHaveBeenCalledWith(
      expect.objectContaining({ localType: 'comment', localId: 12, sgType: 'Note', sgId: 4242 }),
    );
  });

  it('ne crée pas une seconde note pour un commentaire déjà poussé', async () => {
    const { ctx, createAs } = context(true);
    links.findByLocal.mockImplementation(async (_c: number, type: string) =>
      type === 'version' ? { sgId: 900 } : { sgId: 4242 },
    );

    await expect(pushComment(ctx as never, 12)).resolves.toBe(4242);
    expect(createAs).not.toHaveBeenCalled();
  });
});

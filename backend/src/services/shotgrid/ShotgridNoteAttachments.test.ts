// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../lib/prisma', () => ({ prisma: {} }));
vi.mock('../../lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));
vi.mock('../StorageService', () => ({ storage: {} }));

import { asRefs, guessType, sanitize } from './ShotgridNoteAttachments';

describe('guessType', () => {
  it("donne un type image, faute de quoi la pièce jointe n'a pas de vignette", () => {
    // Le fil n'affiche l'aperçu que si le type commence par `image/` : une image
    // rangée en `application/octet-stream` devient une ligne de fichier à télécharger,
    // et l'annotation venue de ShotGrid redevient invisible.
    expect(guessType('annot.png')).toBe('image/png');
    expect(guessType('ANNOT.PNG')).toBe('image/png');
    expect(guessType('frame.jpeg')).toBe('image/jpeg');
    expect(guessType('frame.jpg')).toBe('image/jpeg');
    expect(guessType('capture.webp')).toBe('image/webp');
  });

  it('reconnaît les autres pièces jointes courantes', () => {
    expect(guessType('brief.pdf')).toBe('application/pdf');
  });

  it("n'invente pas de type pour ce qu'il ne connaît pas", () => {
    expect(guessType('rendu.exr')).toBe('application/octet-stream');
    expect(guessType('sans-extension')).toBe('application/octet-stream');
  });
});

describe('asRefs', () => {
  it('retient les pièces jointes', () => {
    expect(
      asRefs([
        { id: 12, type: 'Attachment' },
        { id: 13, type: 'Attachment' },
      ]),
    ).toHaveLength(2);
  });

  it("écarte ce qui n'est pas une pièce jointe", () => {
    // `attachments` peut contenir autre chose selon le site ; aller chercher une Version
    // par l'endpoint des Attachment ne rendrait rien de bon.
    expect(asRefs([{ id: 1, type: 'Version' }, { id: 2, type: 'Attachment' }, null])).toEqual([
      { id: 2, type: 'Attachment' },
    ]);
  });

  it('supporte une note sans pièce jointe', () => {
    expect(asRefs(undefined)).toEqual([]);
    expect(asRefs(null)).toEqual([]);
    expect(asRefs('cassé')).toEqual([]);
  });
});

describe('sanitize', () => {
  it('rend un nom de fichier posable dans une clé de stockage', () => {
    expect(sanitize('Capture d’écran 2026.png')).toBe('Capture_d_cran_2026.png');
  });

  it('empêche toute remontée de chemin', () => {
    // La clé sert ensuite à signer une URL de lecture : y laisser passer « ../ »
    // désignerait le média d'un autre projet.
    const sale = sanitize('../../media/42/source.exr');
    expect(sale).not.toContain('..');
    expect(sale).not.toContain('/');
  });

  it('borne la longueur en gardant la fin, donc l’extension', () => {
    const long = sanitize(`${'a'.repeat(200)}.png`);
    expect(long.length).toBeLessThanOrEqual(80);
    expect(long.endsWith('.png')).toBe(true);
  });
});

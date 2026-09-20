// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { canEditVersionTransform } from './versionPermissions';

/**
 * Table de vérité du droit d'éditer la transformation d'une version. Elle a une conséquence
 * visible : le viewer 3D n'affiche le mode « Nettoyer » que quand ce prédicat est vrai.
 * L'écran répondait auparavant « non publiée + rôle interne », ce qui offrait le bouton
 * « Enregistrer » à un artiste non auteur — que `VersionService.update` refuse en 403.
 */

const AUTHOR = 7;
const OTHER = 8;

describe('canEditVersionTransform', () => {
  it('accorde l’édition à l’auteur d’une version non publiée', () => {
    expect(canEditVersionTransform({ authorId: AUTHOR, published: false }, AUTHOR, false)).toBe(true);
  });

  it('l’accorde au gestionnaire du projet, même s’il n’est pas l’auteur', () => {
    expect(canEditVersionTransform({ authorId: AUTHOR, published: false }, OTHER, true)).toBe(true);
  });

  it('la refuse à un membre interne qui n’est ni auteur ni gestionnaire', () => {
    // C'est exactement le cas qui produisait le bouton mort : le service répond 403.
    expect(canEditVersionTransform({ authorId: AUTHOR, published: false }, OTHER, false)).toBe(false);
  });

  it('la refuse dès que la version est publiée, auteur et gestionnaire compris', () => {
    // Verrou de publication (`assertWritable(version, 'versionTransform')`) : la transform
    // est l'assise de l'A/B et des annotations ancrées au cadre.
    expect(canEditVersionTransform({ authorId: AUTHOR, published: true }, AUTHOR, false)).toBe(false);
    expect(canEditVersionTransform({ authorId: AUTHOR, published: true }, OTHER, true)).toBe(false);
  });

  it('la refuse quand la version n’a pas d’auteur connu et que l’appelant ne gère pas le projet', () => {
    // `authorId` nullable : un compte supprimé laisse la version orpheline. Personne ne
    // devient auteur par défaut — seul un gestionnaire garde la main.
    expect(canEditVersionTransform({ authorId: null, published: false }, OTHER, false)).toBe(false);
    expect(canEditVersionTransform({ authorId: null, published: false }, OTHER, true)).toBe(true);
  });
});

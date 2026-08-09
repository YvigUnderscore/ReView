// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { MediaStatus } from '@prisma/client';
import { inheritsPublication, shouldPublishVersion, shouldUnpublishVersion } from './publishState';

const media = (published: boolean, status: MediaStatus = MediaStatus.READY) => ({ published, status });

describe('shouldPublishVersion', () => {
  it('publie la version quand tous ses médias le sont', () => {
    expect(shouldPublishVersion([media(true), media(true)])).toBe(true);
  });

  it('attend qu’il ne reste plus un seul brouillon', () => {
    expect(shouldPublishVersion([media(true), media(false)])).toBe(false);
  });

  it('ne publie pas une version vide — elle n’a rien à montrer', () => {
    expect(shouldPublishVersion([])).toBe(false);
  });

  it('ignore un média échoué, qui bloquerait la version à jamais', () => {
    expect(shouldPublishVersion([media(true), media(false, MediaStatus.FAILED)])).toBe(true);
  });

  it('ne retient pas une version dont tous les médias ont échoué', () => {
    expect(shouldPublishVersion([media(false, MediaStatus.FAILED)])).toBe(false);
  });

  it('compte un média publié mais encore en traitement', () => {
    // La publication est une décision de visibilité, pas un état du pipeline de transcodage.
    expect(shouldPublishVersion([media(true, MediaStatus.PROCESSING)])).toBe(true);
  });
});

describe('inheritsPublication', () => {
  it('fait naître publié un média rejoignant une version publiée', () => {
    expect(inheritsPublication(true)).toBe(true);
  });

  it('laisse un média en brouillon dans une version en brouillon', () => {
    expect(inheritsPublication(false)).toBe(false);
  });
});

describe('shouldUnpublishVersion', () => {
  it('ne dépublie jamais automatiquement', () => {
    expect(shouldUnpublishVersion()).toBe(false);
  });
});

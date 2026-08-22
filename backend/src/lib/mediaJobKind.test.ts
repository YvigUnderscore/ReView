// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { MediaKind } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { jobKindFor, spatialThumbSource } from './mediaJobKind';

describe('jobKindFor', () => {
  it('aiguille chaque famille de média vers son job de la file média', () => {
    expect(jobKindFor(MediaKind.VIDEO, '.mp4')).toBe('transcode');
    expect(jobKindFor(MediaKind.IMAGE, '.png')).toBe('thumbnail');
    expect(jobKindFor(MediaKind.MODEL_3D, '.usdz')).toBe('convert3d');
  });

  it('ne déclenche aucun job média pour ce qui est servi tel quel', () => {
    // Le GLB natif et les splats n'ont rien à convertir : ils passent READY immédiatement.
    expect(jobKindFor(MediaKind.MODEL_3D, '.glb')).toBeNull();
    expect(jobKindFor(MediaKind.SPLAT, '.ply')).toBeNull();
  });
});

describe('spatialThumbSource', () => {
  it('réclame un rendu Blender pour tout média 3D, converti ou natif', () => {
    expect(spatialThumbSource(MediaKind.MODEL_3D, '.glb')).toBe('model');
    expect(spatialThumbSource(MediaKind.MODEL_3D, '.fbx')).toBe('model');
    expect(spatialThumbSource(MediaKind.MODEL_3D, '.usdz')).toBe('model');
  });

  it('réclame le rasteriseur pour les conteneurs de splat qu’on sait lire', () => {
    expect(spatialThumbSource(MediaKind.SPLAT, '.ply')).toBe('splat');
    expect(spatialThumbSource(MediaKind.SPLAT, '.SPLAT')).toBe('splat');
  });

  it('n’enfile rien pour un conteneur compressé qu’on ne sait pas lire', () => {
    // Mieux vaut pas de vignette qu'un job qui échoue en boucle : .spz/.ksplat/.sog sont
    // couverts par la capture client au premier affichage.
    expect(spatialThumbSource(MediaKind.SPLAT, '.spz')).toBeNull();
    expect(spatialThumbSource(MediaKind.SPLAT, '.ksplat')).toBeNull();
    expect(spatialThumbSource(MediaKind.SPLAT, '.sog')).toBeNull();
  });

  it('ignore la vidéo et l’image, qui ont déjà leur miniature', () => {
    expect(spatialThumbSource(MediaKind.VIDEO, '.mp4')).toBeNull();
    expect(spatialThumbSource(MediaKind.IMAGE, '.jpg')).toBeNull();
  });
});

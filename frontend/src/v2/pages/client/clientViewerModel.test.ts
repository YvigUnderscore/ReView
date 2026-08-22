// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import {
  clientFrameAspect,
  clientLighting,
  clientVariantDefaults,
  mediaTimeOf,
  playerTimeOf,
  resolveClientGlb,
  resolveClientSplat,
  toPlayerComments,
} from './clientViewerModel';
import { DEFAULT_LIGHTING } from '../review/reviewTypes';
import type { ClientMediaSource } from './clientTypes';

const source = (patch: Partial<ClientMediaSource> = {}): ClientMediaSource => ({
  url: 'https://minio.example/bucket/media.mp4?X-Amz-Signature=abc',
  ...patch,
});

/**
 * Ce lot décide de ce qu'un invité peut voir avec ce que la route de partage lui donne.
 * Les cas vérifiés sont ceux qui font la différence entre « la 3D s'affiche » et « le client
 * reçoit un carré noir » : dérivé absent, extension portée par le nom et non par l'URL,
 * présentation ancienne, et le décalage de slate qui déplace tous les commentaires.
 */
describe('resolveClientGlb', () => {
  it('préfère le GLB converti quand le partage l’expose', () => {
    expect(resolveClientGlb(source({ url: 'x/a.usdz', glbUrl: 'x/a.glb?sig' }))).toBe('x/a.glb?sig');
  });

  it('accepte la source quand elle est déjà du glTF, signature comprise', () => {
    expect(resolveClientGlb(source({ url: 'https://s3/a.glb?X-Amz-Signature=z' }))).toContain('.glb');
    expect(resolveClientGlb(source({ url: 'https://s3/a.gltf' }))).toContain('.gltf');
  });

  it('refuse un original non convertible plutôt que de charger un fichier illisible', () => {
    expect(resolveClientGlb(source({ url: 'https://s3/scene.usda?sig' }))).toBeNull();
    expect(resolveClientGlb(source({ url: 'https://s3/mesh.fbx' }))).toBeNull();
    expect(resolveClientGlb(undefined)).toBeNull();
  });
});

describe('resolveClientSplat', () => {
  it('prend l’extension sur le nom d’origine — l’URL présignée porte une query', () => {
    const file = resolveClientSplat(source({ url: 'https://s3/obj?X-Amz-Signature=1' }), 'scan.spz');
    expect(file).toEqual({ url: 'https://s3/obj?X-Amz-Signature=1', fileName: 'scan.spz' });
  });

  it('retombe sur l’URL nettoyée quand le nom d’origine n’est pas parlant', () => {
    const file = resolveClientSplat(source({ url: 'https://s3/scan.ply?sig=1' }), 'version-020');
    expect(file?.fileName).toBe('https://s3/scan.ply');
  });

  it('refuse un fichier que Spark ne sait pas ouvrir', () => {
    expect(resolveClientSplat(source({ url: 'https://s3/a.mp4' }), 'a.mp4')).toBeNull();
  });

  it('accepte les conteneurs SOG des deux orthographes', () => {
    expect(resolveClientSplat(source(), 'scan.sog')?.fileName).toBe('scan.sog');
    expect(resolveClientSplat(source(), 'scan.sogs')?.fileName).toBe('scan.sogs');
  });
});

describe('clientFrameAspect', () => {
  it('rejoue l’aspect du cadre de livraison enregistré', () => {
    const s = source({ splatPresentation: { camera: { position: p(), target: p(), aspect: 2.39 } } });
    expect(clientFrameAspect(s)).toBeCloseTo(2.39);
  });

  it('ignore un aspect dégénéré plutôt que de produire un cadre de hauteur nulle', () => {
    const s = source({ splatPresentation: { camera: { position: p(), target: p(), aspect: 0 } } });
    expect(clientFrameAspect(s)).toBeUndefined();
    expect(clientFrameAspect(source())).toBeUndefined();
  });
});

describe('clientLighting', () => {
  it('préfère le réglage du média au défaut du projet', () => {
    const s = source({
      splatPresentation: { lighting: { ...DEFAULT_LIGHTING, exposure: 2 } },
      projectDefaultLighting: { ...DEFAULT_LIGHTING, exposure: 5 },
    });
    expect(clientLighting(s).exposure).toBe(2);
  });

  it('retombe sur le défaut du projet, puis sur l’éclairage neutre', () => {
    const s = source({ projectDefaultLighting: { ...DEFAULT_LIGHTING, rotationDeg: 90 } });
    expect(clientLighting(s).rotationDeg).toBe(90);
    expect(clientLighting(source())).toEqual(DEFAULT_LIGHTING);
  });

  it('complète un enregistrement ancien auquel un champ manque', () => {
    const partial = { exposure: 3 } as unknown as ClientMediaSource['projectDefaultLighting'];
    expect(clientLighting(source({ projectDefaultLighting: partial }))).toEqual({
      ...DEFAULT_LIGHTING,
      exposure: 3,
    });
  });
});

describe('clientVariantDefaults', () => {
  it('regroupe par prim les jeux de variantes actifs à la conversion', () => {
    expect(
      clientVariantDefaults([
        { prim: '/World/Plate', name: 'modelingVariant', options: ['a', 'b'], selected: 'a' },
        { prim: '/World/Plate', name: 'shadingVariant', options: ['clean'], selected: 'clean' },
      ]),
    ).toEqual({ '/World/Plate': { modelingVariant: 'a', shadingVariant: 'clean' } });
  });

  it('ne suppose rien quand la scène n’est pas décrite', () => {
    expect(clientVariantDefaults(null)).toEqual({});
  });
});

describe('décalage du slate', () => {
  it('retire le slate à l’envoi et le remet au seek — aller-retour neutre', () => {
    expect(mediaTimeOf(8, 3)).toBe(5);
    expect(playerTimeOf(mediaTimeOf(8, 3), 3)).toBe(8);
  });

  it('ne produit jamais de position négative pendant le slate lui-même', () => {
    expect(mediaTimeOf(1.2, 3)).toBe(0);
  });

  it('déplace les marqueurs de la timeline dans le référentiel du lecteur', () => {
    const mapped = toPlayerComments(
      [
        { id: 1, content: 'a', timestamp: 5, guestName: 'Cli', author: null, createdAt: 'x' },
        {
          id: 2,
          content: 'b',
          timestamp: null,
          guestName: null,
          author: { id: 7, name: 'Sup' },
          createdAt: 'x',
        },
      ],
      3,
    );
    expect(mapped[0].timestamp).toBe(8);
    expect(mapped[1].timestamp).toBeNull();
    expect(mapped[1].author).toEqual({ id: 7, name: 'Sup' });
  });

  it('laisse les timestamps intacts quand le dérivé n’a pas de slate', () => {
    const mapped = toPlayerComments(
      [{ id: 1, content: 'a', timestamp: 12, guestName: null, author: null, createdAt: 'x' }],
      0,
    );
    expect(mapped[0].timestamp).toBe(12);
  });
});

/** Pose caméra minimale — seul `aspect` intéresse les tests de cadre. */
function p() {
  return { x: 0, y: 0, z: 0 };
}

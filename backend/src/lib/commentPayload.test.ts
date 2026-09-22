// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import {
  MAX_ANNOTATION_BYTES,
  MAX_POI_POINTS,
  annotationSchema,
  cameraStateSchema,
  guestAnnotationSchema,
  parseAnnotation,
  parseCameraState,
  parseGuestAnnotation,
} from './commentPayload';

/**
 * A2-04 : `annotation` et `cameraState` étaient des `z.any()`. Ces cas disent les deux
 * moitiés du contrat : ce que le viewer envoie réellement doit passer intact, et tout ce
 * qui déborde — champ libre, chaîne démesurée, volume — doit être refusé à l'écriture.
 */

describe('annotationSchema — ce que le viewer envoie passe', () => {
  it('accepte les formes 2D de l’overlay', () => {
    const shapes = [
      {
        id: 'a1',
        type: 'path',
        color: '#ef4444',
        width: 3,
        alpha: 1,
        pts: [
          [0.1, 0.2],
          [0.3, 0.4],
        ],
      },
      { id: 'a2', type: 'rect', color: '#22d3ee', width: 3, x: 0.1, y: 0.1, w: 0.2, h: 0.3 },
      { id: 'a3', type: 'arrow', color: 'red', width: 2, x1: 0, y1: 0, x2: 0.5, y2: 0.5 },
      { id: 'a4', type: 'text', color: '#facc15', width: 4, x: 0.2, y: 0.2, text: 'raccord' },
    ];
    expect(annotationSchema.safeParse(shapes).success).toBe(true);
  });

  it('accepte le hotspot 3D, un trait du painter, une plage vidéo et une anim caméra', () => {
    const parts = [
      { type: 'hotspot', position: '1,2,3', normal: '0,1,0', space: 'object' },
      { type: 'splat-paint', points: [0, 0, 0, 1, 1, 1], color: '#ffffff', width: 2 },
      { type: 'range', inFrame: 24, outFrame: 48 },
      {
        type: 'camera-anim',
        version: 2,
        loop: true,
        channels: { px: { keys: [{ t: 0, v: 1, mode: 'auto' }] } },
      },
    ];
    expect(annotationSchema.safeParse(parts).success).toBe(true);
  });

  it('accepte une animation caméra à tangentes séparées, pondérées et cyclées', () => {
    // Le schéma de l'animation jointe est STRICT : un champ de clé oublié ici ne serait pas
    // silencieusement retiré, il ferait échouer l'envoi du commentaire.
    const parts = [
      {
        type: 'camera-anim',
        version: 2,
        loop: false,
        channels: {
          px: {
            keys: [
              { t: 0, v: 1, mode: 'free', modeIn: 'flat', modeOut: 'free', tin: 0, tout: 0.2 },
              { t: 500, v: 2, mode: 'free', broken: true, tin: 0.1, tout: 0.3, wIn: 1, wOut: 1.5 },
            ],
            pre: 'constant',
            post: 'cycleOffset',
          },
        },
      },
    ];
    expect(annotationSchema.safeParse(parts).success).toBe(true);
  });

  it('garde la base de pose de l’animation jointe', () => {
    // La part est STRICTE : une base omise du schéma partagé ferait échouer l'envoi du
    // commentaire. Et retirée en silence, elle ferait rejouer les canaux non clés sur la vue de
    // chaque spectateur — la cible sauterait à l'origine du monde chez le relecteur.
    const base = { position: { x: 9, y: 3, z: 4 }, target: { x: 1, y: 0.5, z: -2 }, fov: 50 };
    const part = {
      type: 'camera-anim',
      version: 2,
      loop: true,
      base,
      channels: {
        px: {
          keys: [
            { t: 0, v: 0, mode: 'auto' },
            { t: 1_000, v: 10, mode: 'auto' },
          ],
        },
      },
    };
    const [parsed] = annotationSchema.parse([part]) as [typeof part];
    expect(parsed.base).toEqual(base);
    // Et une animation sans base reste acceptée : les commentaires déjà envoyés n'en ont pas.
    const { base: _sansBase, ...nu } = part;
    expect(annotationSchema.safeParse([nu]).success).toBe(true);
  });

  it('garde la durée de lecture de l’animation jointe', () => {
    // Le rejeu doit être à l'identique : `durationMs` fixe la fin de boucle, et sans elle
    // l'animation reçue rebouclerait sur son dernier temps de clé. Le front la laissait sur le
    // quai ; ce cas dit qu'elle traverse l'écriture sans être retirée en silence.
    const part = {
      type: 'camera-anim',
      version: 2,
      loop: true,
      durationMs: 4_000,
      channels: {
        px: {
          keys: [
            { t: 0, v: 0, mode: 'auto' },
            { t: 2_000, v: 10, mode: 'auto' },
          ],
        },
      },
    };
    const [parsed] = annotationSchema.parse([part]) as [typeof part];
    expect(parsed.durationMs).toBe(4_000);
    expect(parsed.channels.px.keys).toHaveLength(2);
  });

  it('accepte une proposition de mise en scène 3D (46.D)', () => {
    const parts = [
      {
        type: 'scene-override',
        override: { version: 1, prims: { '/root/geo': { visible: false } } },
      },
    ];
    expect(annotationSchema.safeParse(parts).success).toBe(true);
  });
});

describe('annotationSchema — ce qui déborde est refusé', () => {
  it('refuse un objet libre au lieu de la liste de parts', () => {
    expect(annotationSchema.safeParse({ pad: 'A'.repeat(1_000) }).success).toBe(false);
  });

  it('refuse une part de type inconnu', () => {
    expect(annotationSchema.safeParse([{ type: 'whatever', pad: 'A' }]).success).toBe(false);
  });

  it('refuse une clé libre glissée dans une forme connue', () => {
    expect(
      annotationSchema.safeParse([{ type: 'rect', x: 0, y: 0, w: 1, h: 1, pad: 'A'.repeat(100_000) }])
        .success,
    ).toBe(false);
  });

  it('refuse une couleur qui n’en est pas une (barrière devant le rendu SVG)', () => {
    expect(annotationSchema.safeParse([{ type: 'rect', color: '#fff" onload="x' }]).success).toBe(false);
    expect(annotationSchema.safeParse([{ type: 'rect', color: 'url(#x)' }]).success).toBe(false);
  });

  it('refuse un texte d’annotation démesuré', () => {
    expect(annotationSchema.safeParse([{ type: 'text', text: 'A'.repeat(50_000) }]).success).toBe(false);
  });

  it('refuse un tracé de plus de quatre mille points', () => {
    const pts = Array.from({ length: 5_000 }, () => [0.5, 0.5]);
    expect(annotationSchema.safeParse([{ type: 'path', pts }]).success).toBe(false);
  });

  it('refuse un volume total au-delà du plafond, même en parts valides', () => {
    // Des traits parfaitement licites, mais assez nombreux pour peser plus que le plafond.
    const stroke = {
      type: 'splat-paint',
      points: Array.from({ length: 12_000 }, (_, i) => i / 1_000),
      color: '#ffffff',
      width: 2,
    };
    const parts = Array.from({ length: 20 }, () => stroke);
    expect(JSON.stringify(parts).length).toBeGreaterThan(MAX_ANNOTATION_BYTES);
    expect(annotationSchema.safeParse(parts).success).toBe(false);
  });

  it('refuse un nombre non fini (NaN/Infinity arrivent en JSON par null ou par chaîne)', () => {
    expect(annotationSchema.safeParse([{ type: 'rect', x: 1e12 }]).success).toBe(false);
  });
});

describe('cameraStateSchema', () => {
  it('accepte la pose capturée par le viewer 3D, état de vue compris', () => {
    const pose = {
      position: { x: 1, y: 2, z: 3 },
      target: { x: 0, y: 0, z: 0 },
      fov: 45,
      aspect: 1.778,
      roll: 0.1,
      view: {
        display: 'wireframe',
        section: { active: true, axis: 'x', position: 0.2, flip: false },
        lighting: {
          hdriId: 'studio',
          exposure: 1,
          rotationDeg: 0,
          showBackground: false,
          groundShadow: true,
        },
      },
    };
    expect(cameraStateSchema.safeParse(pose).success).toBe(true);
  });

  it('accepte la profondeur de champ Spark jointe à la pose', () => {
    const pose = {
      position: { x: 0, y: 0, z: 5 },
      target: { x: 0, y: 0, z: 0 },
      apertureAngle: 0.01,
      focalDistance: 5,
    };
    expect(cameraStateSchema.safeParse(pose).success).toBe(true);
  });

  it('refuse un blob sans pose', () => {
    expect(cameraStateSchema.safeParse({ p: 'A'.repeat(1_000) }).success).toBe(false);
  });

  it('refuse une charge utile cachée dans un champ inconnu', () => {
    expect(
      cameraStateSchema.safeParse({
        position: { x: 0, y: 0, z: 0 },
        target: { x: 0, y: 0, z: 0 },
        pad: 'A'.repeat(1_900_000),
      }).success,
    ).toBe(false);
  });

  it('refuse une focale aberrante', () => {
    expect(
      cameraStateSchema.safeParse({
        position: { x: 0, y: 0, z: 0 },
        target: { x: 0, y: 0, z: 0 },
        fov: 1e9,
      }).success,
    ).toBe(false);
  });
});

describe('parseAnnotation / parseCameraState — relecture à l’écriture', () => {
  it('laissent passer l’absence de valeur', () => {
    expect(parseAnnotation(undefined)).toBeUndefined();
    expect(parseAnnotation(null)).toBeUndefined();
    expect(parseCameraState(undefined)).toBeUndefined();
    expect(parseCameraState(null)).toBeUndefined();
  });

  it('lèvent une erreur 400 plutôt qu’une 500 quand la valeur ne tient pas', () => {
    expect(() => parseAnnotation({ pad: 'A' })).toThrowError(expect.objectContaining({ statusCode: 400 }));
    expect(() => parseCameraState({ pad: 'A' })).toThrowError(expect.objectContaining({ statusCode: 400 }));
  });

  it('rendent la valeur relue, débarrassée de ce qui n’est pas au contrat', () => {
    const parts = [{ type: 'rect', x: 0.1, y: 0.2, w: 0.3, h: 0.4 }];
    expect(parseAnnotation(parts)).toEqual(parts);
  });
});

/**
 * L'annotation d'un INVITÉ est plus étroite que celle d'un membre, et volontairement.
 *
 * Un client dessine sur l'image et pose un point sur une surface : ce sont des remarques.
 * Les trois parts retirées sont des gestes d'auteur, rejoués pour TOUS les spectateurs du
 * média — une proposition de mise en scène 3D, une animation caméra, les traits du painter.
 * Les accepter donnerait à un anonyme muni d'une URL un moyen d'écrire dans ce que voient
 * les autres.
 */
describe('guestAnnotationSchema — ce qu’un lien de partage a le droit d’écrire', () => {
  const rect = { type: 'rect', id: 'a', color: '#ef4444', width: 3, x: 0.1, y: 0.1, w: 0.2, h: 0.2 };

  it('accepte un dessin et un point de surface', () => {
    expect(guestAnnotationSchema.safeParse([rect]).success).toBe(true);
    expect(
      guestAnnotationSchema.safeParse([{ type: 'hotspot', position: '1,2,3', normal: '0,1,0' }]).success,
    ).toBe(true);
  });

  it('refuse les parts d’auteur, que le schéma d’un membre accepte', () => {
    const authored = [
      [{ type: 'scene-override', override: null }],
      [{ type: 'splat-paint', points: [0, 0, 0], color: '#ffffff', width: 1 }],
      [{ type: 'camera-anim', version: 2, loop: false, channels: {} }],
    ];
    for (const parts of authored) {
      // Le membre a le droit : c'est bien l'invité que l'on restreint, pas la forme.
      expect(annotationSchema.safeParse(parts).success).toBe(true);
      expect(guestAnnotationSchema.safeParse(parts).success).toBe(false);
    }
  });

  it('borne le volume plus serré que pour un membre', () => {
    expect(guestAnnotationSchema.safeParse(Array.from({ length: 60 }, () => rect)).success).toBe(true);
    expect(guestAnnotationSchema.safeParse(Array.from({ length: 61 }, () => rect)).success).toBe(false);
    // Un seul champ suffit à faire un gros blob : le plafond d'octets ferme la porte.
    const fat = { type: 'text', x: 0, y: 0, text: 'x'.repeat(2_000) };
    expect(guestAnnotationSchema.safeParse(Array.from({ length: 40 }, () => fat)).success).toBe(false);
  });

  it('relit à l’écriture comme son équivalent interne', () => {
    expect(parseGuestAnnotation(undefined)).toBeUndefined();
    expect(parseGuestAnnotation(null)).toBeUndefined();
    expect(parseGuestAnnotation([rect])).toEqual([rect]);
    expect(() =>
      parseGuestAnnotation([{ type: 'splat-paint', points: [], color: '#fff', width: 1 }]),
    ).toThrowError(expect.objectContaining({ statusCode: 400 }));
  });
});

describe('poiPart — un commentaire porteur, des points numerotes', () => {
  const point = { position: '1 2 3', normal: '0 1 0', space: 'object' as const };

  it('accepte une part unique portant plusieurs points, avec texte et images', () => {
    const parts = [
      {
        type: 'poi',
        points: [
          { ...point, text: 'la soudure', images: ['comments/attachments/3/a.png'] },
          { position: '4 5 6', normal: '0 0 1' },
        ],
      },
    ];
    expect(annotationSchema.safeParse(parts).success).toBe(true);
    expect(parseAnnotation(parts)).toEqual(parts);
  });

  it('exige au moins un point, et n’en accepte pas plus que le plafond', () => {
    expect(annotationSchema.safeParse([{ type: 'poi', points: [] }]).success).toBe(false);
    const many = (n: number) => [{ type: 'poi', points: Array.from({ length: n }, () => point) }];
    expect(annotationSchema.safeParse(many(MAX_POI_POINTS)).success).toBe(true);
    expect(annotationSchema.safeParse(many(MAX_POI_POINTS + 1)).success).toBe(false);
  });

  it('borne chaque champ et refuse toute cle libre', () => {
    const over = [{ type: 'poi', points: [{ ...point, text: 'x'.repeat(2_001) }] }];
    expect(annotationSchema.safeParse(over).success).toBe(false);
    const extra = [{ type: 'poi', points: [{ ...point, author: 'moi' }] }];
    expect(annotationSchema.safeParse(extra).success).toBe(false);
    const images = [{ type: 'poi', points: [{ ...point, images: Array.from({ length: 9 }, () => 'k') }] }];
    expect(annotationSchema.safeParse(images).success).toBe(false);
  });

  it('reste refusee a un invite : un lien de partage ne pose qu’un hotspot', () => {
    const parts = [{ type: 'poi', points: [point] }];
    expect(annotationSchema.safeParse(parts).success).toBe(true);
    expect(guestAnnotationSchema.safeParse(parts).success).toBe(false);
  });

  it('cohabite avec les autres parts du meme commentaire', () => {
    const parts = [
      { type: 'poi', points: [point] },
      { type: 'splat-paint', points: [0, 0, 0], color: '#ffffff', width: 2 },
      { type: 'rect', x: 0, y: 0, w: 0.1, h: 0.1 },
    ];
    expect(annotationSchema.safeParse(parts).success).toBe(true);
  });
});

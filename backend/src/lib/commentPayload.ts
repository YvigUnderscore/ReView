// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { z } from 'zod';
import { cameraAnimShape, channelSchema, curveKeySchema } from './cameraAnimSchema';
import { badRequest } from './errors';
import { MAX_COMMENT_ATTACHMENTS } from './commentAttachments';
import { sceneOverrideSchema } from './sceneOverride';

/**
 * Forme et volume des deux blobs JSON d'un commentaire de review : `annotation` et
 * `cameraState`.
 *
 * Ces deux colonnes étaient déclarées `z.any()` dans les routes. Le plafond effectif était
 * donc celui du parseur de corps (2 Mo) : n'importe quel compte — et, sur la route publique
 * de partage, n'importe quel invité muni du lien — pouvait écrire mégaoctet après
 * mégaoctet de JSON quelconque dans la table `Comment`, puis le faire rediffuser tel quel
 * à toutes les sockets du projet. La validation est ici, au plus près de l'écriture, pour
 * couvrir aussi les appelants qui ne sont pas des routes (`CommentService.createGuest`).
 *
 * Deux principes :
 *  - **L'écriture est stricte, la lecture reste tolérante.** Les annotations déjà en base
 *    ne repassent jamais par ces schémas : `annotationSvg.parseShapes` et
 *    `splitAnnotationParts` continuent de lire ce qui s'y trouve. On ne casse rien de
 *    l'existant, on ferme la porte pour la suite.
 *  - **Chaque chaîne est bornée**, jusqu'au nom de couleur : c'est ce qui rend impossible
 *    le remplissage d'un seul champ avec 1,9 Mo de texte, indépendamment du plafond global.
 */

const finite = z.number().finite();

/** Coordonnée d'annotation 2D : normalisée 0..1, mais une forme peut déborder du cadre. */
const norm = finite.min(-1_000).max(1_000);
/** Coordonnée d'espace objet 3D (hotspot, traits du painter). */
const world = finite.min(-1e6).max(1e6);

/**
 * Couleur de tracé. Le composer n'émet que du `#rrggbb` (`<input type="color">` et la
 * palette `userColor`) ; on tolère les formes courtes/alpha et un nom CSS simple. Aucune
 * de ces formes ne peut contenir de guillemet, de chevron ou de parenthèse — ce qui vaut
 * aussi comme seconde barrière devant le rendu SVG côté serveur.
 */
const color = z
  .string()
  .regex(/^(#[0-9a-fA-F]{3,8}|[a-zA-Z]{1,24})$/)
  .max(24);

// Volumes : larges pour un usage réel, fermés pour un abus.
const MAX_PARTS = 300;
const MAX_PATH_POINTS = 4_000;
/** Coordonnées xyz aplaties d'un trait du painter 3D (soit ~4 000 points). */
const MAX_STROKE_COORDS = 12_000;
const MAX_ANIM_KEYS = 2_000;
/**
 * Points d'intérêt par commentaire. Le plafond est celui d'une remarque numérotée que quelqu'un
 * relit — au-delà de vingt points, c'est une autre review, pas un commentaire. Miroir du front.
 */
export const MAX_POI_POINTS = 20;
/**
 * Plafond global du blob d'annotation, en octets de JSON. Les bornes par champ laissent
 * encore, multipliées entre elles, une place démesurée (300 parts × 4 000 points) : ce
 * plafond est ce qui ramène le pire cas à un ordre de grandeur réaliste. Un commentaire
 * chargé (hotspot + une dizaine de tracés + proposition de scène) pèse quelques kilooctets.
 */
export const MAX_ANNOTATION_BYTES = 512_000;

/** Forme 2D de l'overlay d'annotation — miroir de `v2/components/annotation/geometry.ts`. */
const shapePart = z
  .object({
    type: z.enum(['path', 'rect', 'ellipse', 'arrow', 'polygon', 'text']),
    id: z.string().max(64).optional(),
    color: color.optional(),
    width: finite.min(0).max(100).optional(),
    alpha: finite.min(0).max(1).optional(),
    pts: z.array(z.array(norm).max(4)).max(MAX_PATH_POINTS).optional(),
    x: norm.optional(),
    y: norm.optional(),
    w: norm.optional(),
    h: norm.optional(),
    cx: norm.optional(),
    cy: norm.optional(),
    rx: norm.optional(),
    ry: norm.optional(),
    x1: norm.optional(),
    y1: norm.optional(),
    x2: norm.optional(),
    y2: norm.optional(),
    text: z.string().max(2_000).optional(),
  })
  .strict();

/** Hotspot de surface 3D (10.G-V10) : le point et la normale voyagent en chaîne « x,y,z ». */
const hotspotPart = z
  .object({
    type: z.literal('hotspot'),
    position: z.string().max(120),
    normal: z.string().max(120),
    space: z.literal('object').optional(),
  })
  .strict();

/**
 * Trait de la brosse de surface 3D (10.G-V9), en espace objet du SplatMesh.
 *
 * `width` est une épaisseur **d'écran, en pixels** depuis la Phase 50 (lot 8) : elle valait une
 * grandeur relative à la taille de la scène, donc des unités monde. Les bornes ne changent pas —
 * un nombre de pixels raisonnable entre dans les anciennes.
 *
 * `normal` est la direction depuis laquelle le trait a été peint : elle sert à l'estomper quand
 * le spectateur passe de l'autre côté de la surface. Facultative — les traits écrits avant son
 * introduction n'en ont pas, et restent pleinement visibles.
 */
const paintPart = z
  .object({
    type: z.literal('splat-paint'),
    points: z.array(world).max(MAX_STROKE_COORDS),
    color,
    width: finite.min(0).max(100),
    normal: z.tuple([world, world, world]).optional(),
  })
  .strict();

/** Clé de F-curve — forme partagée avec la présentation persistée (`lib/cameraAnimSchema`). */
const curveKey = curveKeySchema({ minTime: -3_600_000, maxTime: 3_600_000, maxValue: 1e6 }).strict();

/** Animation caméra « par canaux » v2 (Phase 17) jointe au commentaire en mode layout. */
const cameraAnimPart = z
  .object({
    type: z.literal('camera-anim'),
    ...cameraAnimShape(channelSchema(curveKey, { max: MAX_ANIM_KEYS }).strict()),
  })
  .strict();

/** Proposition de mise en scène 3D (46.D) — même schéma que l'override persisté du média. */
const sceneOverridePart = z
  .object({ type: z.literal('scene-override'), override: sceneOverrideSchema.nullable() })
  .strict();

/** Plage vidéo in→out (34.A) : l'annotation reste visible pendant toute la plage. */
const rangePart = z
  .object({
    type: z.literal('range'),
    inFrame: z.number().int().min(0).max(10_000_000),
    outFrame: z.number().int().min(0).max(10_000_000),
  })
  .strict();

/**
 * Un point d'intérêt d'un commentaire porteur (Phase 50, lot 12) : la même géométrie qu'un
 * `hotspot`, plus la remarque qui lui est propre et les pièces jointes du commentaire qui lui
 * appartiennent (référencées par leur clé MinIO — le stockage des pièces ne change pas).
 */
const poiPointSchema = z
  .object({
    position: z.string().max(120),
    normal: z.string().max(120),
    space: z.literal('object').optional(),
    text: z.string().max(2_000).optional(),
    images: z.array(z.string().max(512)).max(MAX_COMMENT_ATTACHMENTS).optional(),
  })
  .strict();

/**
 * Points d'intérêt d'un commentaire — **une seule part pour tous les points**, numérotés par
 * leur rang dans le tableau.
 *
 * La forme a été arbitrée ainsi plutôt qu'en un commentaire par point : un seul commentaire
 * part, il porte le texte de chaque point et les images, et il traverse donc le produit entier
 * (portail client, export de notes, ShotGrid) sans cas particulier. `hotspotPart` reste accepté
 * en écriture : le portail client n'en pose qu'un, et rien ne se réécrit en base.
 */
const poiPart = z
  .object({ type: z.literal('poi'), points: z.array(poiPointSchema).min(1).max(MAX_POI_POINTS) })
  .strict();

const annotationPart = z.union([
  hotspotPart,
  poiPart,
  paintPart,
  cameraAnimPart,
  sceneOverridePart,
  rangePart,
  shapePart,
]);

/**
 * Annotation d'un commentaire : la liste de parts que compose le viewer
 * (`frontend/src/v2/pages/review/useSubmitComment.ts`).
 */
export const annotationSchema = z
  .array(annotationPart)
  .max(MAX_PARTS)
  // `refine` plutôt qu'`addIssue` : le message par défaut de Zod suffit, et l'appelant
  // reçoit de toute façon le refus générique de `parseAnnotation`.
  .refine((parts) => JSON.stringify(parts).length <= MAX_ANNOTATION_BYTES);

const vec3 = z.object({ x: world, y: world, z: world }).strict();

/** État de vue du viewer 3D joint à la pose (mode d'affichage, coupe, éclairage — 39). */
const viewState = z
  .object({
    display: z.string().max(40).optional(),
    section: z
      .object({
        active: z.boolean().optional(),
        axis: z.enum(['x', 'y', 'z']).optional(),
        position: world.optional(),
        flip: z.boolean().optional(),
      })
      .strict()
      .optional(),
    lighting: z
      .object({
        hdriId: z.string().max(200).optional(),
        exposure: finite.min(0).max(100).optional(),
        rotationDeg: finite.min(-3_600).max(3_600).optional(),
        showBackground: z.boolean().optional(),
        groundShadow: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

/**
 * Pose caméra jointe à un commentaire 3D/splat — miroir de `SplatCamera`/`ModelCameraState`
 * côté front, et cousin du `camPose` de `media-splat.routes.ts`. `strict()` : la surface
 * publique de partage l'accepte d'un invité non authentifié, aucune clé libre n'y a sa place.
 */
export const cameraStateSchema = z
  .object({
    position: vec3,
    target: vec3,
    fov: finite.min(1).max(179).optional(),
    aspect: finite.min(0.01).max(100).optional(),
    roll: finite
      .min(-2 * Math.PI)
      .max(2 * Math.PI)
      .optional(),
    // Profondeur de champ Spark, répliquée avec la pose (10.G).
    apertureAngle: finite.min(0).max(1).optional(),
    focalDistance: finite.min(0).max(1e6).optional(),
    view: viewState.optional(),
  })
  .strict();

/**
 * Relit un blob venu du client au moment de l'écriture. `undefined`/`null` restent tels
 * quels (le champ est facultatif) ; tout le reste doit entrer dans le schéma.
 *
 * Les routes valident déjà par Zod ; ce second passage tient parce que toutes les entrées
 * ne passent pas par une route de ce module — `createGuest` est appelé depuis la surface
 * publique de partage, et c'est justement celle-là qu'il ne faut pas rater.
 */
export function parseAnnotation(value: unknown): unknown {
  if (value == null) return undefined;
  const parsed = annotationSchema.safeParse(value);
  // Le détail Zod n'apprendrait rien d'utile à l'appelant : refus sec, comme ailleurs.
  if (!parsed.success) throw badRequest('Invalid annotation');
  return parsed.data;
}

/**
 * Annotation d'un **invité** — plus étroite que celle d'un membre, et volontairement.
 *
 * Un client dessine sur l'image et pose un point sur une surface : ce sont des remarques.
 * Les trois parts retirées ici sont des gestes d'AUTEUR, rejoués pour tous les spectateurs
 * du média : `scene-override` (proposition de mise en scène 3D, 46.D), `camera-anim` (une
 * animation caméra par canaux) et `splat-paint` (les traits du painter 3D). Aucune n'a de
 * sens venue d'un lien de partage, et les accepter donnerait à un anonyme muni d'une URL un
 * moyen d'écrire dans ce que voient les autres.
 *
 * Les volumes sont resserrés dans la même intention : cinq fois moins de parts et huit fois
 * moins d'octets que pour un membre. C'est large pour une page de retours, étroit pour un
 * robot.
 */
const GUEST_MAX_PARTS = 60;
const GUEST_MAX_ANNOTATION_BYTES = 64_000;

export const guestAnnotationSchema = z
  .array(z.union([hotspotPart, shapePart]))
  .max(GUEST_MAX_PARTS)
  .refine((parts) => JSON.stringify(parts).length <= GUEST_MAX_ANNOTATION_BYTES);

/**
 * Même contrat que `parseAnnotation`, appliqué à la surface publique. Il vit ici, au plus
 * près de l'écriture, et non dans la route : `createGuest` est appelable d'ailleurs, et
 * c'est précisément cet appelant-là qu'il ne faut pas rater.
 */
export function parseGuestAnnotation(value: unknown): unknown {
  if (value == null) return undefined;
  const parsed = guestAnnotationSchema.safeParse(value);
  if (!parsed.success) throw badRequest('Invalid annotation');
  return parsed.data;
}

export function parseCameraState(value: unknown): unknown {
  if (value == null) return undefined;
  const parsed = cameraStateSchema.safeParse(value);
  if (!parsed.success) throw badRequest('Invalid cameraState');
  return parsed.data;
}

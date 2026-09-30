// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { z } from 'zod';

/**
 * Forme validée d'une animation caméra « par canaux » v2 (Phase 17 ; côtés de tangente séparés,
 * pondération et pré/post-infinity en Phase 50, lot 7).
 *
 * Elle était écrite **deux fois** : dans la route de présentation persistée et dans le payload de
 * commentaire — deux schémas qu'il fallait penser à faire évoluer ensemble. Ils ne le sont plus :
 * les deux appelants dérivent d'ici, avec leurs propres bornes (une présentation est bornée à 256
 * clés par canal, une animation jointe à un commentaire à 2 000).
 *
 * Le champ manquant ne serait pas une erreur visible : `z.object` **retire** silencieusement ce
 * qu'il ne connaît pas, donc un profil de tangente nouveau serait enregistré sans son côté séparé
 * et la courbe changerait de forme d'un rechargement à l'autre. Tout nouveau champ de clé — et
 * tout nouveau champ d'animation, comme la base de la Phase 50 lot 13 — se déclare ici, en
 * `optional()`, le jour où il est écrit côté client.
 */

const finite = z.number().finite();

/** Canaux animables — miroir de `CHANNEL_IDS` côté front. */
export const CHANNEL_ID_VALUES = ['px', 'py', 'pz', 'tx', 'ty', 'tz', 'fov', 'roll'] as const;
/** Mode unifié legacy d'une clé (forme d'origine de la v2, toujours écrite). */
export const TANGENT_MODE_VALUES = ['auto', 'linear', 'step', 'free'] as const;
/** Type de tangente d'un côté de clé. */
export const TANGENT_TYPE_VALUES = ['auto', 'linear', 'flat', 'step', 'free'] as const;
/** Extrapolation d'un canal hors de ses clés. */
export const EXTRAPOLATION_VALUES = ['constant', 'cycle', 'cycleOffset', 'linear', 'oscillate'] as const;

/** Clé d'une F-curve. `maxValue` absent = toute valeur finie (présentation persistée). */
export function curveKeySchema(opts: { minTime: number; maxTime: number; maxValue?: number }) {
  const value = opts.maxValue == null ? finite : finite.min(-opts.maxValue).max(opts.maxValue);
  const tangentType = z.enum(TANGENT_TYPE_VALUES);
  return z.object({
    t: finite.min(opts.minTime).max(opts.maxTime), // ms depuis le début
    v: value,
    tin: finite.optional(),
    tout: finite.optional(),
    mode: z.enum(TANGENT_MODE_VALUES),
    modeIn: tangentType.optional(),
    modeOut: tangentType.optional(),
    broken: z.boolean().optional(),
    // Pondérations : le client les borne plus serré (0,05 à 1,5) et reclampe à la lecture.
    wIn: finite.min(0).max(3).optional(),
    wOut: finite.min(0).max(3).optional(),
  });
}

/** Canal : ses clés triées et son extrapolation de part et d'autre. */
export function channelSchema(keys: z.ZodTypeAny, bounds: { min?: number; max: number }) {
  const extrapolation = z.enum(EXTRAPOLATION_VALUES);
  return z.object({
    keys: z
      .array(keys)
      .min(bounds.min ?? 0)
      .max(bounds.max),
    pre: extrapolation.optional(),
    post: extrapolation.optional(),
  });
}

const vec3 = z.object({ x: finite, y: finite, z: finite });

/**
 * Pose de repli persistée **avec** l'animation (Phase 50, lot 13) : les canaux sans clé la lisent à
 * l'échantillonnage, chez tout spectateur et à l'export. Facultative — une animation enregistrée
 * avant elle n'en porte pas et garde le repli dynamique du client, dont le rejeu ne change pas.
 * Bornes reprises de la pose caméra de la présentation (`media-splat.routes`) : c'est la même vue,
 * capturée par le même viewer. Elle ne porte que les grandeurs échantillonnées — ni aspect, ni
 * profondeur de champ : la base n'est pas une deuxième présentation.
 */
const cameraAnimBase = z.object({
  position: vec3,
  target: vec3,
  fov: finite.min(5).max(150).optional(),
  roll: finite.min(-Math.PI).max(Math.PI).optional(),
});

/** Animation complète (hors discriminant `type` du payload de commentaire). */
export function cameraAnimShape(channels: z.ZodTypeAny) {
  return {
    version: z.literal(2),
    loop: z.boolean(),
    durationMs: z.number().int().min(0).max(3_600_000).optional(),
    channels: z.record(z.enum(CHANNEL_ID_VALUES), channels),
    base: cameraAnimBase.optional(),
  };
}

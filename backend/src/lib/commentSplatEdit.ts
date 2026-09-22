// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Parts binaires d'une **proposition d'édition de nuage** (Phase 50, lot 14) : le masque de
 * suppression (bitset par indice de splat) et les ops de sous-ensemble ne tiennent pas dans
 * une annotation — ce sont des blobs de plusieurs centaines de kilo-octets.
 *
 * Ils voyagent donc exactement comme une **pièce jointe de commentaire** : même dossier
 * MinIO (`comments/attachments/<auteur>/`), même présignature, même purge à l'édition et à
 * la suppression. La part `splat-edit` n'en garde que la RÉFÉRENCE (la clé), et la lecture
 * ne résout cette clé que dans les pièces jointes DU MÊME commentaire — lesquelles sont
 * déjà filtrées par préfixe. Une clé étrangère glissée dans la part ne donne donc aucune
 * URL : c'est la même garantie que pour les images d'un point d'intérêt.
 *
 * Ce que ce module ajoute, et qui n'existe pour aucune autre pièce jointe : un **plafond de
 * taille vérifié par le serveur**. Une pièce jointe ordinaire part en PUT présigné, sans
 * que rien ne relise sa taille ; un blob d'édition, lui, est relu (`statObject`) au moment
 * où le commentaire le déclare, et refusé au-delà du plafond du masque de média. Sans cela,
 * la proposition serait le seul chemin du dépôt par lequel un nuage de suppression sans
 * limite entrerait dans une review.
 */

import { z } from 'zod';
import { badRequest } from './errors';

/**
 * Plafond d'un blob de proposition : celui du masque du média (`SplatEditService`,
 * MAX_MASK_BYTES). La proposition ne doit pas pouvoir porter plus que ce qu'un
 * gestionnaire enregistrerait pour tout le monde.
 */
export const MAX_SPLAT_EDIT_BLOB_BYTES = 4_000_000;

/** Référence d'un blob : la clé de l'objet et son compte (splats masqués / ops rejouées). */
export interface SplatEditBlobRef {
  key: string;
  count: number;
}

/**
 * Forme acceptée en entrée. `count` est de l'affichage (« N splats retirés ») : il est borné
 * mais jamais cru sur parole — c'est le blob qui fait foi au rejeu.
 */
export const splatEditBlobRef = z
  .object({ key: z.string().min(1).max(512), count: z.number().int().positive().max(100_000_000) })
  .strict();

/** Les deux références d'une part `splat-edit`, quand la part en porte. */
function refsOf(part: unknown): SplatEditBlobRef[] {
  if (!part || typeof part !== 'object') return [];
  const { mask, subset } = part as { mask?: unknown; subset?: unknown };
  return [mask, subset].filter(
    (ref): ref is SplatEditBlobRef =>
      !!ref && typeof ref === 'object' && typeof (ref as { key?: unknown }).key === 'string',
  );
}

/**
 * Clés des blobs référencés par les parts `splat-edit` d'une annotation.
 *
 * La colonne est du JSON libre et peut avoir été écrite par une version antérieure : la
 * lecture ne suppose rien de sa forme.
 */
export function splatEditBlobKeys(annotation: unknown): string[] {
  if (!Array.isArray(annotation)) return [];
  const keys = annotation
    .filter((part) => (part as { type?: unknown } | null)?.type === 'splat-edit')
    .flatMap(refsOf)
    .map((ref) => ref.key);
  return [...new Set(keys)];
}

/**
 * Refuse une proposition dont un blob n'est pas une pièce jointe du commentaire, manque du
 * stockage, ou dépasse le plafond.
 *
 * Les trois refus comptent, et le premier est le plus important : **le blob doit figurer
 * dans la liste de pièces jointes du commentaire**. C'est elle qui décide de la vie de
 * l'objet — elle est filtrée par préfixe (donc pas d'objet d'autrui), et c'est elle que la
 * purge relit à l'édition comme à la suppression. Une référence hors liste donnerait un
 * objet que rien ne ramasse : exactement la fuite déjà trouvée et fermée ici pour les
 * images de commentaire.
 *
 * `stat` est injecté (le `StorageService` de l'appelant) : la vérification reste testable
 * sans MinIO, et c'est elle qui rend le plafond réel plutôt que déclaratif.
 */
export async function assertSplatEditBlobs(
  annotation: unknown,
  opts: { attachedKeys: Iterable<string>; stat: (key: string) => Promise<{ size: number }> },
): Promise<void> {
  const keys = splatEditBlobKeys(annotation);
  if (keys.length === 0) return;
  const attached = new Set(opts.attachedKeys);
  for (const key of keys) {
    if (!attached.has(key)) throw badRequest('Splat edit data must be attached', 'SPLAT_EDIT_UNATTACHED');
    const size = await opts.stat(key).then(
      (o) => o.size,
      () => null,
    );
    if (size === null) throw badRequest('Splat edit data not found', 'SPLAT_EDIT_MISSING');
    if (size > MAX_SPLAT_EDIT_BLOB_BYTES)
      throw badRequest('Splat edit data too large', 'SPLAT_EDIT_TOO_LARGE');
  }
}

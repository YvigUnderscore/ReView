// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Pièces jointes d'un commentaire : quelles clés MinIO on accepte d'un client, et
 * lesquelles deviennent orphelines quand on réécrit la liste.
 *
 * La clé est fournie par le CLIENT puis sert à signer une URL de lecture : le filtre de
 * préfixe est une **garde de sécurité**, pas une commodité d'écriture. Sans lui, joindre
 * la clé d'un autre utilisateur suffirait à lire sa pièce jointe, sur un autre projet.
 */

import { z } from 'zod';

/** Descripteur envoyé par le client : la clé de l'objet et ses étiquettes d'affichage. */
export interface AttachmentRef {
  key: string;
  name?: string;
  contentType?: string;
}

/** Plafond par commentaire (miroir du front). */
export const MAX_COMMENT_ATTACHMENTS = 8;

/**
 * Forme acceptée en entrée, à la création comme à l'édition. Elle borne la FORME et le
 * volume ; la propriété des clés, elle, se vérifie dans le service (`filterAttachments`).
 */
export const attachmentsSchema = z
  .array(
    z.object({
      key: z.string().max(512),
      name: z.string().max(200).optional(),
      contentType: z.string().max(100).optional(),
    }),
  )
  .max(MAX_COMMENT_ATTACHMENTS);

/**
 * Racine MinIO des pièces jointes de commentaire.
 *
 * Les dossiers sont CONCATÉNÉS et non interpolés : un gabarit ferait passer cette clé de
 * stockage pour du texte d'interface aux yeux de `check-untranslated`, qui compte chaque
 * fragment d'un gabarit backend (même raison que `frontend/src/test/apiMock.ts`).
 */
const ROOT = 'comments/attachments/';

/** Dossier qu'un utilisateur remplit lui-même, via une URL présignée à son nom. */
export const ownAttachmentPrefix = (userId: number) => ROOT + userId + '/';

/**
 * Dossier des pièces rapatriées d'une note ShotGrid : il appartient au commentaire, pas à
 * une personne. Une édition doit pouvoir les conserver — les refuser reviendrait à effacer
 * les pièces venues du site distant dès la première correction de texte.
 */
export const shotgridAttachmentPrefix = (commentId: number) => ROOT + 'shotgrid/' + commentId + '/';

/** Ne garde que les clés issues d'un des dossiers autorisés (et jamais de remontée `..`). */
export function filterAttachments(
  attachments: AttachmentRef[] | undefined,
  prefixes: string[],
): AttachmentRef[] {
  return (attachments ?? []).filter(
    (a) => !a.key.includes('..') && prefixes.some((prefix) => a.key.startsWith(prefix)),
  );
}

/** Clés d'un blob `attachments` relu en base — colonne JSON, donc forme non garantie. */
export function attachmentKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((a) => (a && typeof a === 'object' ? (a as { key?: unknown }).key : null))
    .filter((key): key is string => typeof key === 'string' && key.length > 0);
}

/**
 * Objets à effacer du stockage : présents avant, absents après. Sans cela, retirer une
 * image d'un commentaire (ou supprimer le commentaire) la laissait dans MinIO à vie.
 */
export function orphanedKeys(before: unknown, after: unknown): string[] {
  const kept = new Set(attachmentKeys(after));
  return [...new Set(attachmentKeys(before))].filter((key) => !kept.has(key));
}

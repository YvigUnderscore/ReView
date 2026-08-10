// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { badRequest } from './errors';

/** Préfixe des clés produites par `POST /documents/pdf/presign` — le seul dossier légitime. */
const DOC_KEY_PREFIX = 'documents/';

/**
 * Une clé de fichier de document est-elle acceptable ?
 *
 * Elle est fournie par le client, puis présignée en lecture (`GET /:id`) et supprimée
 * définitivement (`DELETE /:id`). Sans ce garde-fou, un compte quelconque déclare
 * `fileKey: 'media/<autre projet>/source.exr'` et obtient une URL de lecture sur n'importe
 * quel objet du bucket — puis l'efface en supprimant son propre document.
 */
export const isValidDocumentKey = (key: string | null | undefined): key is string =>
  typeof key === 'string' && key.startsWith(DOC_KEY_PREFIX) && !key.includes('..');

/** Variante levant une 400 — utilisée à l'écriture. */
export function assertDocumentKey(key: string): string {
  if (!isValidDocumentKey(key)) throw badRequest('Clé de fichier invalide', 'INVALID_FILE_KEY');
  return key;
}

/** Clé d'upload d'un PDF de document : nom de fichier assaini, horodaté. */
export const documentUploadKey = (filename: string): string =>
  `${DOC_KEY_PREFIX}${Date.now()}-${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

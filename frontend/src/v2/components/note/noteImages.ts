// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createContext, useContext } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../lib/apiClient';
import type { NoteKind } from '../../lib/notesApi';
import { t } from '../../i18n';
import type { ImageResolver } from './noteRender';

/**
 * Les images qu'une fiche porte : les y déposer, puis les afficher.
 *
 * Le dépôt suit la voie habituelle — présignature, PUT direct vers MinIO, la fiche
 * n'enregistre que la clé. L'affichage fait le chemin inverse : les clés d'une fiche sont
 * résolues en un seul appel, et le résultat vit dans le cache de requêtes, ce qui évite de
 * redemander la même URL à chaque frappe pendant l'édition.
 */

/** Types acceptés au dépôt (miroir du Zod backend). */
export const NOTE_IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/avif';

const ACCEPTED = /^image\/(png|jpe?g|webp|gif|avif)$/;

export const isAcceptedNoteImage = (file: File): boolean => ACCEPTED.test(file.type);

export interface UploadedNoteImage {
  /** Ce qui s'écrit dans la fiche. */
  key: string;
  /** Ce qui s'affiche tout de suite, sans attendre une résolution. */
  url: string;
  alt: string;
}

/**
 * Dépose une image et rend de quoi l'écrire dans la fiche.
 *
 * Le nom du fichier devient le texte de remplacement : c'est le seul libellé que
 * quelqu'un ait écrit, et une planche de références sans aucun `alt` est illisible au
 * lecteur d'écran comme au moteur de recherche interne.
 */
export async function uploadNoteImage(kind: NoteKind, id: number, file: File): Promise<UploadedNoteImage> {
  const { url, key, readUrl } = await api.post<{ url: string; key: string; readUrl: string }>(
    `/api/${kind}/${id}/note/images/presign`,
    { filename: file.name, contentType: file.type },
  );
  const put = await fetch(url, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
  // Le dépôt va droit à MinIO : le message d'échec est le nôtre, personne d'autre n'en écrit.
  if (!put.ok) throw new Error(t('note.images.failed', { name: file.name }));
  return { key, url: readUrl, alt: file.name.replace(/\.[^.]*$/, '') };
}

/**
 * Les URL de lecture d'un lot de clés.
 *
 * Les clés sont triées avant de servir de clé de cache : le même ensemble d'images
 * demandé dans un autre ordre est le même appel, et une fiche réordonnée ne doit pas
 * repartir chercher ce qu'elle a déjà.
 */
export function useNoteImageUrls(keys: string[]) {
  const sorted = [...new Set(keys)].sort();
  return useQuery({
    queryKey: ['note-images', sorted],
    queryFn: () =>
      api
        .post<{ urls: Record<string, string> }>('/api/note-images/resolve', { keys: sorted })
        .then((r) => r.urls),
    enabled: sorted.length > 0,
    // Les URL présignées vivent une heure ; les redemander avant serait du bruit.
    staleTime: 30 * 60_000,
  });
}

/**
 * La table de résolution en vigueur pour l'arbre affiché.
 *
 * Un contexte plutôt qu'une prop : la résolution traverse la fiche, les sections, les
 * planches et jusqu'au HTML du markdown. La faire descendre à la main aurait imposé un
 * paramètre à chaque composant de rendu, y compris ceux qui n'affichent aucune image.
 */
const NoteImageContext = createContext<ImageResolver | undefined>(undefined);

export const NoteImageProvider = NoteImageContext.Provider;

export function useNoteImageResolver(): ImageResolver {
  const resolve = useContext(NoteImageContext);
  // Sans fournisseur, une fiche qui ne porte que des URL externes s'affiche quand même.
  return resolve ?? (() => undefined);
}

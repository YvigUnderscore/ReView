// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createContext, useContext } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/apiClient';
import type { NoteKind } from '../../lib/notesApi';
import { t } from '../../i18n';
import type { ImageResolver } from './noteRender';

/**
 * The images a note carries: putting them in, then displaying them.
 *
 * Dropping follows the usual route: presigning, a direct PUT to MinIO, and the note only saves the key. Display takes the
 * reverse path: a note's keys are resolved in a single call, and the result lives in the query cache, which avoids asking
 * for the same URL again on every keystroke while editing.
 */

/** Types accepted on drop (mirror of the backend Zod schema). */
export const NOTE_IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/avif';

const ACCEPTED = /^image\/(png|jpe?g|webp|gif|avif)$/;

export const isAcceptedNoteImage = (file: File): boolean => ACCEPTED.test(file.type);

export interface UploadedNoteImage {
  /** What is written into the note. */
  key: string;
  /** What is displayed straight away, without waiting for a resolution. */
  url: string;
  alt: string;
}

/**
 * Drops an image and returns what is needed to write it into the note.
 *
 * The file name becomes the replacement text: it is the only label anyone has written, and a reference board without any
 * `alt` is unreadable to the screen reader as well as to the internal search engine.
 */
export async function uploadNoteImage(kind: NoteKind, id: number, file: File): Promise<UploadedNoteImage> {
  const { url, key, readUrl } = await api.post<{ url: string; key: string; readUrl: string }>(
    `/api/${kind}/${id}/note/images/presign`,
    { filename: file.name, contentType: file.type },
  );
  const put = await fetch(url, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
  // The upload goes straight to MinIO: the failure message is ours, nobody else writes one.
  if (!put.ok) throw new Error(t('note.images.failed', { name: file.name }));
  return { key, url: readUrl, alt: file.name.replace(/\.[^.]*$/, '') };
}

/**
 * Read URLs for a batch of keys.
 *
 * The keys are sorted before serving as the cache key: the same set of images requested in another order is the same call,
 * and a reordered note must not go fetch again what it already has.
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
    // Presigned URLs live for one hour; requesting them again earlier would be noise.
    staleTime: 30 * 60_000,
  });
}

/**
 * The resolution table in force for the displayed tree.
 *
 * A context rather than a prop: resolution goes through the note, the sections, the boards and down to the markdown's HTML.
 * Passing it down by hand would have imposed a parameter on every rendering component, including those that display no image.
 */
const NoteImageContext = createContext<ImageResolver | undefined>(undefined);

export const NoteImageProvider = NoteImageContext.Provider;

export function useNoteImageResolver(): ImageResolver {
  const resolve = useContext(NoteImageContext);
  // Without a provider, a note carrying only external URLs still displays.
  return resolve ?? (() => undefined);
}

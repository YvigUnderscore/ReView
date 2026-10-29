// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import type { NoteKind } from '../../lib/notesApi';
import { uploadNoteImage, type UploadedNoteImage } from './noteImages';
import { useT } from '../../i18n';

/**
 * Image uploads while a note is being edited.
 *
 * Files leave **together**: dropping a board of twelve references one after the other would make one wait a minute where
 * five seconds are needed. And each is independent: a corrupt file in the middle of the batch must not take the other eleven
 * with it; it reports its failure and the others arrive.
 *
 * The read URLs returned at upload are kept here: the image displays the second it is dropped, without waiting for the note
 * to be saved or for its keys to be resolved.
 */
export function useNoteUploads(kind: NoteKind, id: number) {
  const t = useT();
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const upload = useCallback(
    async (files: File[]): Promise<UploadedNoteImage[]> => {
      setBusy(true);
      try {
        const settled = await Promise.allSettled(files.map((file) => uploadNoteImage(kind, id, file)));
        const done: UploadedNoteImage[] = [];
        settled.forEach((result, i) => {
          if (result.status === 'fulfilled') {
            done.push(result.value);
            return;
          }
          // The server's message when there is one (archived project, missing right); ours otherwise. Saying "failed"
          // without saying which of the twelve files is at fault is no help.
          const reason = result.reason;
          toast.error(
            reason instanceof Error ? reason.message : t('note.images.failed', { name: files[i].name }),
          );
        });
        if (done.length > 0) {
          setUrls((prev) => ({ ...prev, ...Object.fromEntries(done.map((i) => [i.key, i.url])) }));
        }
        return done;
      } finally {
        setBusy(false);
      }
    },
    [kind, id, t],
  );

  return { upload, busy, urls };
}

// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import type { NoteKind } from '../../lib/notesApi';
import { uploadNoteImage, type UploadedNoteImage } from './noteImages';
import { useT } from '../../i18n';

/**
 * Le dépôt d'images pendant l'édition d'une fiche.
 *
 * Les fichiers partent **ensemble** : déposer une planche de douze références en file
 * indienne ferait attendre une minute là où il en faut cinq secondes. Et chacun est
 * indépendant — un fichier corrompu au milieu du lot ne doit pas emporter les onze autres,
 * il signale son échec et les autres arrivent.
 *
 * Les URL de lecture rendues au dépôt sont conservées ici : l'image s'affiche à la seconde
 * où elle est déposée, sans attendre que la fiche soit enregistrée ni que ses clés soient
 * résolues.
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
          // Le message du serveur quand il y en a un (projet archivé, droit manquant) ;
          // le nôtre sinon — dire « échec » sans dire lequel des douze fichiers n'aide pas.
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

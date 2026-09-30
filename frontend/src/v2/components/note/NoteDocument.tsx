// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useMemo } from 'react';
import { noteImageKeys } from './noteMarkdown';
import { NoteImageProvider, useNoteImageUrls } from './noteImages';
import NoteView from './NoteView';

/**
 * Une fiche affichée, images comprises.
 *
 * `NoteView` se contente de poser des blocs — il ne connaît ni le réseau ni le cache, ce
 * qui le rend testable sans rien monter autour. C'est ici que les clés enregistrées dans la
 * fiche redeviennent des URL de lecture, en un seul appel pour toute la fiche, et que le
 * résultat est mis à disposition de l'arbre.
 */
export default function NoteDocument({
  source,
  /** Images déjà connues (celles qu'on vient de déposer) : évite un aller-retour. */
  extraUrls,
}: {
  source: string;
  extraUrls?: Record<string, string>;
}) {
  const keys = useMemo(() => noteImageKeys(source), [source]);
  const { data: urls } = useNoteImageUrls(keys);

  const resolve = useCallback((src: string) => extraUrls?.[src] ?? urls?.[src], [extraUrls, urls]);

  return (
    <NoteImageProvider value={resolve}>
      <NoteView source={source} />
    </NoteImageProvider>
  );
}

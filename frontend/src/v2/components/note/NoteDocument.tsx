// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useMemo } from 'react';
import { noteImageKeys } from './noteMarkdown';
import { NoteImageProvider, useNoteImageUrls } from './noteImages';
import NoteView from './NoteView';

/**
 * A displayed note, images included.
 *
 * `NoteView` merely places blocks: it knows neither the network nor the cache, which makes it testable without
 * mounting anything around it. This is where the keys stored in the note turn back into read URLs, in a single call
 * for the whole note, and where the result is made available to the tree.
 */
export default function NoteDocument({
  source,
  /** Images already known (the ones just dropped): avoids a round trip. */
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

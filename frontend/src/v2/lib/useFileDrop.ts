// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState, type DragEvent } from 'react';
import { filesFromDataTransfer } from './dropEntries';

/**
 * Drop target for files (Phase 46).
 *
 * Dropping is the natural gesture for delivering work; the application reserved it for a
 * single zone, forcing one to create the version, then aim at the upload button, then
 * go through a file picker. This hook makes any element droppable, so that
 * each version is its own target.
 *
 * A dropped folder is unfolded: this is how a shot delivered as an image sequence arrives,
 * and `dataTransfer.files` alone would have ignored it without a word.
 */
export function useFileDrop(onFiles: (files: File[]) => void) {
  const [over, setOver] = useState(false);

  return {
    /** True while hovering: up to the caller to turn it into visual feedback. */
    over,
    dropProps: {
      onDragOver: (e: DragEvent) => {
        // Without preventDefault, the browser opens the file instead of handing it to us.
        e.preventDefault();
        setOver(true);
      },
      onDragLeave: () => setOver(false),
      onDrop: (e: DragEvent) => {
        e.preventDefault();
        // A drop on a version must not bubble up to the "new version" zone
        // enclosing it: otherwise the same file would be sent twice.
        e.stopPropagation();
        setOver(false);
        // Entries are read during the event: the call is therefore sent before any `await`.
        void filesFromDataTransfer(e.dataTransfer).then((files) => {
          if (files.length > 0) onFiles(files);
        });
      },
    },
  };
}

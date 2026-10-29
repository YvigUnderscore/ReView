// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { BoardFiles } from './boardFiles';

/**
 * Fingerprint of a board scene: what tells whether it has **really** changed.
 *
 * Excalidraw calls `onChange` well beyond real edits: cursor moves, scrolling, selection, and any
 * render triggered by the parent component. The autosave compared the pending snapshot with the one it had just written **by object identity**
 * (`pendingRef.current === snapshot`); but `onChange` builds a new object on each
 * call, so equality was never true. The snapshot was never purged, the "saving…" indicator
 * never went off, and a board merely **open** rewrote its row in the database every ~1.2 s — endlessly, and for each open studio tab.
 *
 * The fingerprint relies on the `version` counter that Excalidraw increments on each
 * real mutation of an element: two identical scenes give the same string, and comparing it costs
 * far less than a full serialisation of the document.
 *
 * Images are reduced to their identifiers: the content of a file never changes
 * under a given identifier, and the runtime form (dataURL) differs from the stored
 * form (uploaded to MinIO) — comparing them would make the fingerprint diverge for nothing.
 */
export function sceneSignature(elements: readonly unknown[], files: BoardFiles): string {
  const parts: string[] = [];
  for (const element of elements) {
    if (!element || typeof element !== 'object') {
      // Unexpected shape: fall back to the content, even at the cost of serialisation.
      parts.push(JSON.stringify(element));
      continue;
    }
    const { id, version, versionNonce, isDeleted } = element as {
      id?: unknown;
      version?: unknown;
      versionNonce?: unknown;
      isDeleted?: unknown;
    };
    if (typeof id !== 'string' || typeof version !== 'number') {
      parts.push(JSON.stringify(element));
      continue;
    }
    // `versionNonce` breaks ties between two concurrent edits arriving at the same version number.
    parts.push(
      `${id}:${version}:${typeof versionNonce === 'number' ? versionNonce : 0}:${isDeleted ? 1 : 0}`,
    );
  }
  // File identifiers are sorted: the order of an object's keys carries no meaning.
  const fileIds = Object.keys(files ?? {}).sort();
  return `${parts.join('|')}#${fileIds.join(',')}`;
}

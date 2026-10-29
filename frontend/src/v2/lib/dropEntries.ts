// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Reading a drop (drag & drop), **folders included**.
 *
 * `DataTransfer.files` ignores directories: dropping a folder of shots produced
 * nothing, without any message. The entries API (`webkitGetAsEntry`, supported by all the
 * target browsers) gives access to the tree; we walk it and return a flat list
 * of `File`, which the upload queue already knows how to consume.
 *
 * API constraint: `dataTransfer.items` is only valid **during** the `drop` event.
 * The entries are therefore retrieved synchronously, and only their reading is
 * asynchrone.
 */

/** Maximum explored depth: a shot tree is flat, not a git repository. */
const MAX_DEPTH = 8;
/**
 * Volume safeguard.
 *
 * The cap was 500 files, and it cut silently: dropping a shot of 1,200
 * EXR frames, the most ordinary delivery in the trade, would have lost 700 without a word.
 * It is aligned with what the server accepts for a sequence
 * (`MAX_SEQUENCE_FRAMES`, backend/src/lib/imageSequence.ts): beyond that, it is a drop
 * of a whole tree, not a delivery.
 */
const MAX_FILES = 10_000;

/** Ignores filesystem service files (.DS_Store, .gitkeep…). */
const isHidden = (name: string): boolean => name.startsWith('.');

function fileOf(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

/** `readEntries` returns only one batch at a time (100 under Chrome): we read until empty. */
function readAll(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve) => {
    const all: FileSystemEntry[] = [];
    const step = (): void =>
      reader.readEntries(
        (batch) => {
          if (batch.length === 0) return resolve(all);
          all.push(...batch);
          step();
        },
        () => resolve(all),
      );
    step();
  });
}

async function collect(entry: FileSystemEntry, out: File[], depth: number): Promise<void> {
  if (out.length >= MAX_FILES || isHidden(entry.name)) return;
  if (entry.isFile) {
    const file = await fileOf(entry as FileSystemFileEntry).catch(() => null);
    if (file) out.push(file);
    return;
  }
  if (!entry.isDirectory || depth >= MAX_DEPTH) return;
  for (const child of await readAll((entry as FileSystemDirectoryEntry).createReader())) {
    await collect(child, out, depth + 1);
  }
}

/**
 * Files of a drop, folders unfolded. Falls back to `dataTransfer.files` when the entries
 * API is absent (drop from another application, old browser).
 */
export async function filesFromDataTransfer(dt: DataTransfer | null | undefined): Promise<File[]> {
  if (!dt) return [];
  const plain = Array.from(dt.files ?? []);
  const entries = Array.from(dt.items ?? [])
    .filter((item) => item.kind === 'file')
    .map((item) => (typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null));
  if (entries.every((entry) => entry === null)) return plain;

  const out: File[] = [];
  for (const entry of entries) {
    if (entry) await collect(entry, out, 0);
  }
  // An unreadable tree must not be worse than the previous behaviour.
  return out.length > 0 ? out.slice(0, MAX_FILES) : plain;
}

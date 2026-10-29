// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { filesFromDataTransfer } from './dropEntries';

/**
 * Dropping a folder of shots produced nothing, without any message: `DataTransfer.files`
 * ignores directories. These cases describe the tree as the browsers' entries API renders it,
 * including its pitfalls (batched reading, hidden files).
 */

const fileEntry = (name: string): FileSystemEntry =>
  ({
    name,
    isFile: true,
    isDirectory: false,
    file: (cb: (f: File) => void) => cb(new File(['x'], name)),
  }) as unknown as FileSystemEntry;

/** Directory whose children the reader returns **in batches**, as Chrome does. */
const dirEntry = (name: string, children: FileSystemEntry[], batch = 100): FileSystemEntry => {
  let cursor = 0;
  return {
    name,
    isFile: false,
    isDirectory: true,
    createReader: () => ({
      readEntries: (cb: (e: FileSystemEntry[]) => void) => {
        const slice = children.slice(cursor, cursor + batch);
        cursor += slice.length;
        cb(slice);
      },
    }),
  } as unknown as FileSystemEntry;
};

const transfer = (entries: (FileSystemEntry | null)[], files: File[] = []): DataTransfer =>
  ({
    files,
    items: entries.map((entry) => ({ kind: 'file', webkitGetAsEntry: () => entry })),
  }) as unknown as DataTransfer;

describe('filesFromDataTransfer', () => {
  it('unfolds a dropped folder into a flat list of files', async () => {
    const dt = transfer([dirEntry('SQ010', [fileEntry('sh010.mov'), fileEntry('sh020.mov')])]);
    const files = await filesFromDataTransfer(dt);
    expect(files.map((f) => f.name)).toEqual(['sh010.mov', 'sh020.mov']);
  });

  it('descends into subfolders and mixes files and folders of the same drop', async () => {
    const dt = transfer([
      fileEntry('brief.pdf'),
      dirEntry('SQ010', [dirEntry('sh010', [fileEntry('sh010_v001.exr')])]),
    ]);
    const files = await filesFromDataTransfer(dt);
    expect(files.map((f) => f.name)).toEqual(['brief.pdf', 'sh010_v001.exr']);
  });

  it('reads a batched folder to the end', async () => {
    const many = Array.from({ length: 250 }, (_, i) => fileEntry(`sh${i}.mov`));
    const files = await filesFromDataTransfer(transfer([dirEntry('SQ010', many, 100)]));
    expect(files).toHaveLength(250);
  });

  it('ignores filesystem service files', async () => {
    const dt = transfer([dirEntry('SQ010', [fileEntry('.DS_Store'), fileEntry('sh010.mov')])]);
    expect((await filesFromDataTransfer(dt)).map((f) => f.name)).toEqual(['sh010.mov']);
  });

  it('renders a whole shot: 1,200 EXR frames are not cut at 500', async () => {
    const plan = Array.from({ length: 1200 }, (_, i) =>
      fileEntry(`SH0100_comp_v003.${String(1001 + i)}.exr`),
    );
    expect(await filesFromDataTransfer(transfer([dirEntry('SH0100', plan)]))).toHaveLength(1200);
  });

  it('still bounds an oversized drop rather than flooding the queue', async () => {
    const many = Array.from({ length: 10_400 }, (_, i) => fileEntry(`sh${String(i)}.mov`));
    expect(await filesFromDataTransfer(transfer([dirEntry('SQ010', many)]))).toHaveLength(10_000);
  });

  it('falls back to `files` when the entries API is absent (original behaviour)', async () => {
    const plain = [new File(['x'], 'plan.mov')];
    const dt = { files: plain, items: [{ kind: 'file' }] } as unknown as DataTransfer;
    expect(await filesFromDataTransfer(dt)).toEqual(plain);
  });

  it('falls back to `files` if the tree yields nothing readable', async () => {
    const plain = [new File(['x'], 'plan.mov')];
    const dt = transfer([dirEntry('vide', [])], plain);
    expect(await filesFromDataTransfer(dt)).toEqual(plain);
  });

  it('returns an empty list without a dataTransfer', async () => {
    expect(await filesFromDataTransfer(null)).toEqual([]);
  });
});

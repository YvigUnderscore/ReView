// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { DragEvent } from 'react';
import { useFileDrop } from './useFileDrop';

/**
 * A shot delivered as an image sequence arrives as a FOLDER. The drop target read it through
 * `dataTransfer.files`, which ignores directories: the drop produced nothing. What
 * is verified here is that the hook does go through the directory-tree reading.
 */

const fileEntry = (name: string): FileSystemEntry =>
  ({
    name,
    isFile: true,
    isDirectory: false,
    file: (cb: (f: File) => void) => cb(new File(['x'], name)),
  }) as unknown as FileSystemEntry;

const dirEntry = (name: string, children: FileSystemEntry[]): FileSystemEntry => {
  let done = false;
  return {
    name,
    isFile: false,
    isDirectory: true,
    createReader: () => ({
      readEntries: (cb: (e: FileSystemEntry[]) => void) => {
        // The flag drops BEFORE the callback: the reader rereads within the callback itself.
        const batch = done ? [] : children;
        done = true;
        cb(batch);
      },
    }),
  } as unknown as FileSystemEntry;
};

const dropEvent = (entries: FileSystemEntry[]): DragEvent =>
  ({
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    dataTransfer: {
      files: [],
      items: entries.map((entry) => ({ kind: 'file', webkitGetAsEntry: () => entry })),
    },
  }) as unknown as DragEvent;

describe('useFileDrop', () => {
  it('unfolds a dropped folder and returns its frames', async () => {
    const onFiles = vi.fn();
    const { result } = renderHook(() => useFileDrop(onFiles));
    const folder = dirEntry('SH0100_comp_v003', [fileEntry('plan.1001.exr'), fileEntry('plan.1002.exr')]);
    act(() => result.current.dropProps.onDrop(dropEvent([folder])));
    await vi.waitFor(() => expect(onFiles).toHaveBeenCalledTimes(1));
    expect((onFiles.mock.calls[0][0] as File[]).map((f) => f.name)).toEqual([
      'plan.1001.exr',
      'plan.1002.exr',
    ]);
  });

  it('does not bubble the drop up to the enclosing zone: a file is not sent twice', () => {
    const { result } = renderHook(() => useFileDrop(vi.fn()));
    const event = dropEvent([fileEntry('a.mov')]);
    act(() => result.current.dropProps.onDrop(event));
    expect(event.stopPropagation).toHaveBeenCalled();
  });

  it('ignore un dossier vide', async () => {
    const onFiles = vi.fn();
    const { result } = renderHook(() => useFileDrop(onFiles));
    act(() => result.current.dropProps.onDrop(dropEvent([dirEntry('vide', [])])));
    await Promise.resolve();
    await Promise.resolve();
    expect(onFiles).not.toHaveBeenCalled();
  });
});

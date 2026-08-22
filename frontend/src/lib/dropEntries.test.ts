// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { filesFromDataTransfer } from './dropEntries';

/**
 * Déposer un dossier de plans ne produisait rien, sans message : `DataTransfer.files`
 * ignore les répertoires. Ces cas décrivent l'arborescence telle que la rend l'API
 * d'entrées des navigateurs, y compris ses pièges (lecture par lots, fichiers cachés).
 */

const fileEntry = (name: string): FileSystemEntry =>
  ({
    name,
    isFile: true,
    isDirectory: false,
    file: (cb: (f: File) => void) => cb(new File(['x'], name)),
  }) as unknown as FileSystemEntry;

/** Répertoire dont le lecteur rend les enfants **par lots**, comme le fait Chrome. */
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
  it('déplie un dossier déposé en liste plate de fichiers', async () => {
    const dt = transfer([dirEntry('SQ010', [fileEntry('sh010.mov'), fileEntry('sh020.mov')])]);
    const files = await filesFromDataTransfer(dt);
    expect(files.map((f) => f.name)).toEqual(['sh010.mov', 'sh020.mov']);
  });

  it('descend dans les sous-dossiers et mêle fichiers et dossiers du même dépôt', async () => {
    const dt = transfer([
      fileEntry('brief.pdf'),
      dirEntry('SQ010', [dirEntry('sh010', [fileEntry('sh010_v001.exr')])]),
    ]);
    const files = await filesFromDataTransfer(dt);
    expect(files.map((f) => f.name)).toEqual(['brief.pdf', 'sh010_v001.exr']);
  });

  it('relit jusqu’au bout un dossier rendu par lots', async () => {
    const many = Array.from({ length: 250 }, (_, i) => fileEntry(`sh${i}.mov`));
    const files = await filesFromDataTransfer(transfer([dirEntry('SQ010', many, 100)]));
    expect(files).toHaveLength(250);
  });

  it('ignore les fichiers de service du système de fichiers', async () => {
    const dt = transfer([dirEntry('SQ010', [fileEntry('.DS_Store'), fileEntry('sh010.mov')])]);
    expect((await filesFromDataTransfer(dt)).map((f) => f.name)).toEqual(['sh010.mov']);
  });

  it('borne un dépôt démesuré plutôt que de noyer la file', async () => {
    const many = Array.from({ length: 900 }, (_, i) => fileEntry(`sh${i}.mov`));
    expect(await filesFromDataTransfer(transfer([dirEntry('SQ010', many)]))).toHaveLength(500);
  });

  it('replie sur `files` quand l’API d’entrées est absente (comportement d’origine)', async () => {
    const plain = [new File(['x'], 'plan.mov')];
    const dt = { files: plain, items: [{ kind: 'file' }] } as unknown as DataTransfer;
    expect(await filesFromDataTransfer(dt)).toEqual(plain);
  });

  it('replie sur `files` si l’arborescence ne donne rien de lisible', async () => {
    const plain = [new File(['x'], 'plan.mov')];
    const dt = transfer([dirEntry('vide', [])], plain);
    expect(await filesFromDataTransfer(dt)).toEqual(plain);
  });

  it('rend une liste vide sans dataTransfer', async () => {
    expect(await filesFromDataTransfer(null)).toEqual([]);
  });
});

// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { mergeCatalog, render } from './i18n-add.mjs';

/** Catalogue minimal au format Prettier : une clé par ligne, saut de ligne final. */
const catalog = (...entries) => `{\n${entries.join('\n')}\n}\n`;

const BASE = catalog('  "admin.title": "Admin",', '  "upload.hint": "Drop here"');

describe('render', () => {
  it('rend une chaîne simple, une clé par ligne', () => {
    expect(render('a.b', 'Hello')).toBe('  "a.b": "Hello",');
  });

  it('rend les formes plurielles sur une seule ligne', () => {
    expect(render('a.n', { one: '{count} item', other: '{count} items' })).toBe(
      '  "a.n": { "one": "{count} item", "other": "{count} items" },',
    );
  });
});

describe('mergeCatalog', () => {
  it('insère la clé à la suite des clés de même préfixe', () => {
    const { content, written, missing } = mergeCatalog(BASE, { 'admin.new': { en: 'New' } }, 'en');
    expect(written).toBe(1);
    expect(missing).toEqual([]);
    expect(content.split('\n')).toEqual([
      '{',
      '  "admin.title": "Admin",',
      '  "admin.new": "New",',
      '  "upload.hint": "Drop here"',
      '}',
      '',
    ]);
  });

  it('préserve les entrées existantes et produit un JSON valide', () => {
    const { content } = mergeCatalog(BASE, { 'admin.new': { en: 'New' } }, 'en');
    expect(JSON.parse(content)).toEqual({
      'admin.title': 'Admin',
      'admin.new': 'New',
      'upload.hint': 'Drop here',
    });
  });

  it('ajoute une clé sans préfixe connu en fin de catalogue, sans virgule finale', () => {
    const { content } = mergeCatalog(BASE, { 'zzz.alone': { en: 'Alone' } }, 'en');
    expect(content.split('\n')).toEqual([
      '{',
      '  "admin.title": "Admin",',
      '  "upload.hint": "Drop here",',
      '  "zzz.alone": "Alone"',
      '}',
      '',
    ]);
    expect(JSON.parse(content)['zzz.alone']).toBe('Alone');
  });

  it('met à jour une clé déjà présente sur place, sans doublon', () => {
    const { content, written } = mergeCatalog(BASE, { 'admin.title': { en: 'Studio' } }, 'en');
    expect(written).toBe(1);
    expect(JSON.parse(content)).toEqual({ 'admin.title': 'Studio', 'upload.hint': 'Drop here' });
    expect(content.match(/admin\.title/g)).toHaveLength(1);
  });

  it('ne donne pas de virgule à la dernière entrée quand elle est mise à jour', () => {
    const { content } = mergeCatalog(BASE, { 'upload.hint': { en: 'Drag here' } }, 'en');
    expect(content.split('\n')).toContain('  "upload.hint": "Drag here"');
    expect(JSON.parse(content)['upload.hint']).toBe('Drag here');
  });

  it('écrit les formes plurielles de la langue : complètes en anglais', () => {
    const batch = {
      'admin.count': {
        en: { one: '{count} item', other: '{count} items' },
        ja: { other: '{count} 件' },
      },
    };
    const { content } = mergeCatalog(BASE, batch, 'en');
    expect(JSON.parse(content)['admin.count']).toEqual({
      one: '{count} item',
      other: '{count} items',
    });
  });

  it('écrit les formes plurielles de la langue : « other » seul en japonais', () => {
    const batch = {
      'admin.count': {
        en: { one: '{count} item', other: '{count} items' },
        ja: { other: '{count} 件' },
      },
    };
    const { content } = mergeCatalog(BASE, batch, 'ja');
    expect(JSON.parse(content)['admin.count']).toEqual({ other: '{count} 件' });
  });

  it('insère après la fermeture d’une valeur plurielle étalée sur plusieurs lignes', () => {
    const raw = catalog(
      '  "admin.count": {',
      '    "one": "{count} item",',
      '    "other": "{count} items"',
      '  },',
      '  "upload.hint": "Drop here"',
    );
    const { content } = mergeCatalog(raw, { 'admin.new': { en: 'New' } }, 'en');
    expect(JSON.parse(content)).toEqual({
      'admin.count': { one: '{count} item', other: '{count} items' },
      'admin.new': 'New',
      'upload.hint': 'Drop here',
    });
    // L'insertion vise la fermeture `},`, pas l'intérieur de la valeur.
    expect(content.indexOf('"admin.new"')).toBeGreaterThan(content.indexOf('  },'));
  });

  it('signale une traduction absente du lot sans toucher au catalogue', () => {
    const { content, written, missing } = mergeCatalog(BASE, { 'admin.new': { fr: 'Nouveau' } }, 'en');
    expect(missing).toEqual(['en ← admin.new']);
    expect(written).toBe(0);
    expect(content).toBe(BASE);
  });

  it('compte une écriture par clé posée', () => {
    const { written } = mergeCatalog(BASE, { 'admin.a': { en: 'A' }, 'admin.b': { en: 'B' } }, 'en');
    expect(written).toBe(2);
  });

  it('préserve les fins de ligne CRLF du catalogue', () => {
    const raw = BASE.replaceAll('\n', '\r\n');
    const { content } = mergeCatalog(raw, { 'admin.new': { en: 'New' } }, 'en');
    expect(content).toContain('\r\n');
    expect(content.replaceAll('\r\n', '')).not.toContain('\n');
  });
});

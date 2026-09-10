// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  SETTINGS_FIELDS,
  SETTINGS_HOMES,
  fieldDisplay,
  fieldUnit,
  fieldsFor,
  isDirty,
  settingsPayload,
  type SettingField,
} from './studioSettings';

const field = (over: Partial<SettingField> = {}): SettingField => ({
  key: 'k',
  labelKey: 'common.save',
  hintKey: 'common.save',
  home: 'settings',
  ...over,
});

describe('répartition des réglages', () => {
  it('donne une maison connue à chaque champ', () => {
    for (const f of SETTINGS_FIELDS) expect(SETTINGS_HOMES, f.key).toContain(f.home);
  });

  it('ne laisse aucun champ dans deux sections', () => {
    const keys = SETTINGS_FIELDS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('range chaque champ là où on le cherche', () => {
    const home = (key: string) => SETTINGS_FIELDS.find((f) => f.key === key)?.home;
    expect(home('storage_limit_user')).toBe('storage');
    expect(home('max_file_size')).toBe('storage');
    expect(home('trash_retention_days')).toBe('retention');
    expect(home('default_start_frame')).toBe('defaults');
    expect(home('slack_webhook_url')).toBe('chat');
    expect(home('live_sync_hz_video')).toBe('live');
    expect(home('studio_source_url')).toBe('settings');
  });

  it('rend les champs d’une section, et rien d’autre', () => {
    expect(fieldsFor('live').map((f) => f.key)).toEqual([
      'live_sync_hz_video',
      'live_sync_hz_image',
      'live_sync_hz_3d',
      'live_sync_hz_splat',
    ]);
    expect(fieldsFor('retention').map((f) => f.key)).toEqual(['trash_retention_days']);
  });

  /** La section fourre-tout ne doit pas se reconstituer par accumulation. */
  it('ne laisse à « Réglages » que l’identité de l’instance', () => {
    expect(fieldsFor('settings').map((f) => f.key)).toEqual(['studio_source_url']);
  });
});

describe('« quelque chose a changé »', () => {
  it('reste inerte tant que rien n’est saisi', () => {
    expect(isDirty({})).toBe(false);
    expect(isDirty({ a: '' })).toBe(true);
  });
});

describe('valeur affichée', () => {
  it('préfère la saisie en cours à la valeur enregistrée', () => {
    const f = field({ key: 'max_concurrent_uploads' });
    expect(fieldDisplay(f, { max_concurrent_uploads: '5' }, {})).toBe('5');
    expect(fieldDisplay(f, { max_concurrent_uploads: '5' }, { max_concurrent_uploads: '9' })).toBe('9');
  });

  it('remet une taille dans son unité lisible', () => {
    const f = field({ key: 'max_file_size', bytes: true });
    expect(fieldDisplay(f, { max_file_size: '5000000000' }, {})).toBe('5');
    expect(fieldUnit(f, { max_file_size: '5000000000' }, {})).toBe('Go');
    expect(fieldUnit(f, { max_file_size: '5000000000' }, { max_file_size: 'Mo' })).toBe('Mo');
  });

  it('n’affiche pas un zéro là où rien n’est réglé', () => {
    const f = field({ key: 'max_file_size', bytes: true });
    expect(fieldDisplay(f, {}, {})).toBe('');
  });
});

describe('écritures envoyées', () => {
  const fields = [field({ key: 'quota', bytes: true }), field({ key: 'hook' })];

  it('n’envoie que ce qui a été touché', () => {
    const { entries, invalidKey } = settingsPayload(fields, { hook: 'https://x' }, {});
    expect(invalidKey).toBeNull();
    expect(entries).toEqual([{ key: 'hook', value: 'https://x' }]);
  });

  it('convertit les tailles selon l’unité affichée', () => {
    expect(settingsPayload(fields, { quota: '2' }, { quota: 'Go' }).entries).toEqual([
      { key: 'quota', value: '2000000000' },
    ]);
    expect(settingsPayload(fields, { quota: '2' }, { quota: 'Mo' }).entries).toEqual([
      { key: 'quota', value: '2000000' },
    ]);
  });

  it('refuse tout l’enregistrement plutôt que d’en écrire la moitié', () => {
    const res = settingsPayload(fields, { hook: 'https://x', quota: 'douze' }, { quota: 'Go' });
    expect(res.invalidKey).toBe('quota');
    expect(res.entries).toEqual([]);
  });

  /** Les champs sur mesure (langue, accent, politique) partagent le même brouillon. */
  it('laisse passer une clé qui n’a pas de champ générique', () => {
    expect(settingsPayload(fields, { studio_accent: '#ff0000' }, {}).entries).toEqual([
      { key: 'studio_accent', value: '#ff0000' },
    ]);
  });
});

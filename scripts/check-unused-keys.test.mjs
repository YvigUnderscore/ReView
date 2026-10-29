// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { SETS, catalogKeys, citations, unusedKeys } from './check-unused-keys.mjs';

const dir = mkdtempSync(join(tmpdir(), 'review-unused-keys-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Throwaway set: a catalogue and a folder of sources, as in real life. */
function fixture(name, catalog, files) {
  const root = join(dir, name);
  mkdirSync(join(root, 'src'), { recursive: true });
  const catalogFile = join(root, 'en.json');
  writeFileSync(catalogFile, JSON.stringify(catalog), 'utf8');
  for (const [file, source] of Object.entries(files)) writeFileSync(join(root, 'src', file), source, 'utf8');
  return { name, catalog: catalogFile, roots: [join(root, 'src')] };
}

describe('citations', () => {
  it('reports a key cited as is', () => {
    expect(citations("t('shots.add');").exact.has('shots.add')).toBe(true);
  });

  it('reports the prefix of a key built by template', () => {
    expect([...citations('t(`shotgrid.entity.${kind}`);').prefixes]).toEqual(['shotgrid.entity.']);
  });

  it('reports the prefix of a key built by concatenation', () => {
    expect([...citations("t('admin.group.' + name);").prefixes]).toEqual(['admin.group.']);
  });

  it('does not take a URL template for a key prefix', () => {
    expect([...citations('fetch(`/api/projects/${id}`);').prefixes]).toEqual([]);
  });
});

describe('unusedKeys', () => {
  it('returns only the keys that no source cites', () => {
    const set = fixture(
      'simple',
      { 'shots.add': 'Add', 'shots.remove': 'Remove', 'common.save': 'Save' },
      {
        'A.tsx': "export const A = () => <b>{t('shots.add')}</b>;",
        'B.ts': "export const k = 'common.save';",
      },
    );
    expect(unusedKeys(set)).toEqual(['shots.remove']);
  });

  it('treats as used any key descending from a built prefix', () => {
    const set = fixture(
      'prefix',
      { 'onboarding.step1': 'One', 'onboarding.step2': 'Two', 'dead.key': 'Dead' },
      { 'A.ts': 'export const label = (n: number) => t(`onboarding.step${n}`);' },
    );
    expect(unusedKeys(set)).toEqual(['dead.key']);
  });

  it('counts keys cited from a second folder of sources', () => {
    const front = fixture('cross-front', { 'notification.mentioned': 'You were mentioned' }, {});
    const back = fixture(
      'cross-back',
      {},
      { 'S.ts': "export const k = { messageKey: 'notification.mentioned' };" },
    );
    expect(unusedKeys({ ...front, roots: [...front.roots, ...back.roots] })).toEqual([]);
    expect(unusedKeys(front)).toEqual(['notification.mentioned']);
  });
});

describe('repository sets', () => {
  it('declares both catalogues, the frontend also citing the backend sources', () => {
    const frontend = SETS.find((s) => s.name === 'frontend');
    const roots = frontend.roots.map((r) => r.split(/[\\/]/).slice(-2).join('/'));
    expect(roots).toEqual(['frontend/src', 'backend/src']);
    expect(catalogKeys(frontend.catalog).length).toBeGreaterThan(1000);
  });

  // This case re-reads all of `backend/src` looking for citations: a few
  // tens of milliseconds on a development machine, several seconds on a
  // shared runner — vitest's five-second ceiling was reached there.
  it('ne trouve aucune clé morte côté backend', () => {
    expect(unusedKeys(SETS.find((s) => s.name === 'backend'))).toEqual([]);
  }, 30_000);
});

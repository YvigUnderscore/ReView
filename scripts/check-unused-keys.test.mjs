// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { SETS, catalogKeys, citations, unusedKeys } from './check-unused-keys.mjs';

const dir = mkdtempSync(join(tmpdir(), 'review-unused-keys-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Jeu jetable : un catalogue et un dossier de sources, comme en vrai. */
function fixture(name, catalog, files) {
  const root = join(dir, name);
  mkdirSync(join(root, 'src'), { recursive: true });
  const catalogFile = join(root, 'en.json');
  writeFileSync(catalogFile, JSON.stringify(catalog), 'utf8');
  for (const [file, source] of Object.entries(files)) writeFileSync(join(root, 'src', file), source, 'utf8');
  return { name, catalog: catalogFile, roots: [join(root, 'src')] };
}

describe('citations', () => {
  it('relève une clé citée telle quelle', () => {
    expect(citations("t('shots.add');").exact.has('shots.add')).toBe(true);
  });

  it('relève le préfixe d’une clé construite par gabarit', () => {
    expect([...citations('t(`shotgrid.entity.${kind}`);').prefixes]).toEqual(['shotgrid.entity.']);
  });

  it('relève le préfixe d’une clé construite par concaténation', () => {
    expect([...citations("t('admin.group.' + name);").prefixes]).toEqual(['admin.group.']);
  });

  it('ne prend pas un gabarit d’URL pour un préfixe de clé', () => {
    expect([...citations('fetch(`/api/projects/${id}`);').prefixes]).toEqual([]);
  });
});

describe('unusedKeys', () => {
  it('ne rend que les clés qu’aucune source ne cite', () => {
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

  it('tient pour employée toute clé descendant d’un préfixe construit', () => {
    const set = fixture(
      'prefix',
      { 'onboarding.step1': 'One', 'onboarding.step2': 'Two', 'dead.key': 'Dead' },
      { 'A.ts': 'export const label = (n: number) => t(`onboarding.step${n}`);' },
    );
    expect(unusedKeys(set)).toEqual(['dead.key']);
  });

  it('compte les clés citées depuis un second dossier de sources', () => {
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

describe('jeux du dépôt', () => {
  it('déclare les deux catalogues, le front citant aussi les sources backend', () => {
    const frontend = SETS.find((s) => s.name === 'frontend');
    const roots = frontend.roots.map((r) => r.split(/[\\/]/).slice(-2).join('/'));
    expect(roots).toEqual(['frontend/src', 'backend/src']);
    expect(catalogKeys(frontend.catalog).length).toBeGreaterThan(1000);
  });

  it('ne trouve aucune clé morte côté backend', () => {
    expect(unusedKeys(SETS.find((s) => s.name === 'backend'))).toEqual([]);
  });
});

// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  normalizeVersion,
  readPackageVersion,
  resolveVersion,
  shortCommit,
  UNKNOWN_VERSION,
  versionLabel,
} from './version';

describe('resolveVersion', () => {
  it('préfère la version injectée à la construction plutôt que celle du paquet', () => {
    const info = resolveVersion({ APP_VERSION: 'v2.4.1' }, '2.0.0');
    expect(info.version).toBe('2.4.1');
  });

  it('retombe sur le package.json quand rien n’est injecté', () => {
    expect(resolveVersion({}, '2.0.0').version).toBe('2.0.0');
  });

  it('ne prend pas une valeur vide ou « unknown » pour une version', () => {
    expect(resolveVersion({ APP_VERSION: '   ' }, '2.0.0').version).toBe('2.0.0');
    expect(resolveVersion({ APP_VERSION: 'unknown' }, null).version).toBe(UNKNOWN_VERSION);
    expect(resolveVersion({}, null).version).toBe(UNKNOWN_VERSION);
  });

  it('raccourcit le commit et accepte les deux noms de variable', () => {
    expect(resolveVersion({ GIT_SHA: 'A1B2C3D4E5F60718293A4B5C6D7E8F9012345678' }, null).commit).toBe(
      'a1b2c3d4e5f6',
    );
    expect(resolveVersion({ GIT_COMMIT: 'deadbeef' }, null).commit).toBe('deadbeef');
    expect(resolveVersion({}, null).commit).toBeNull();
  });

  it('transporte la date de construction telle quelle', () => {
    expect(resolveVersion({ BUILD_DATE: '2026-08-22T10:00:00Z' }, null).builtAt).toBe('2026-08-22T10:00:00Z');
    expect(resolveVersion({ BUILD_DATE: '' }, null).builtAt).toBeNull();
  });
});

describe('normalizeVersion / shortCommit / versionLabel', () => {
  it('retire le « v » des étiquettes git, jamais celui d’un nom', () => {
    expect(normalizeVersion('v1.2.3')).toBe('1.2.3');
    expect(normalizeVersion('1.2.3')).toBe('1.2.3');
    // `git describe` d'un dépôt aux étiquettes historiques en majuscule.
    expect(normalizeVersion('V1.1.1-573-g7f8c200')).toBe('1.1.1-573-g7f8c200');
    expect(normalizeVersion('vnext')).toBe('vnext');
    expect(normalizeVersion(null)).toBeNull();
  });

  it('borne une référence non hexadécimale sans la déformer', () => {
    expect(shortCommit('branche-de-test')).toBe('branche-de-test');
  });

  it('affiche version et commit d’un seul tenant', () => {
    expect(versionLabel({ version: '2.1.0', commit: 'abc123def456', builtAt: null })).toBe(
      '2.1.0+abc123def456',
    );
    expect(versionLabel({ version: '2.1.0', commit: null, builtAt: null })).toBe('2.1.0');
  });
});

describe('readPackageVersion', () => {
  it('remonte l’arborescence jusqu’au premier package.json lisible', () => {
    const root = mkdtempSync(join(tmpdir(), 'review-version-'));
    writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '9.9.9' }));
    const deep = join(root, 'dist', 'lib');
    mkdirSync(deep, { recursive: true });
    expect(readPackageVersion(deep)).toBe('9.9.9');
  });

  it('rend null plutôt que de lever quand rien n’est trouvé', () => {
    const empty = mkdtempSync(join(tmpdir(), 'review-version-empty-'));
    expect(readPackageVersion(empty, 0)).toBeNull();
  });

  it('ignore un package.json illisible ou sans version', () => {
    const root = mkdtempSync(join(tmpdir(), 'review-version-bad-'));
    writeFileSync(join(root, 'package.json'), '{ pas du json');
    expect(readPackageVersion(root, 0)).toBeNull();
  });
});

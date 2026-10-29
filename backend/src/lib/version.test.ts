// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  compareSemver,
  normalizeVersion,
  readPackageVersion,
  resolveVersion,
  shortCommit,
  UNKNOWN_VERSION,
  versionLabel,
} from './version';

describe('resolveVersion', () => {
  it('prefers the version injected at build time over the package one', () => {
    const info = resolveVersion({ APP_VERSION: 'v2.4.1' }, '2.0.0');
    expect(info.version).toBe('2.4.1');
  });

  it('falls back to package.json when nothing is injected', () => {
    expect(resolveVersion({}, '2.0.0').version).toBe('2.0.0');
  });

  it('does not take an empty or "unknown" value as a version', () => {
    expect(resolveVersion({ APP_VERSION: '   ' }, '2.0.0').version).toBe('2.0.0');
    expect(resolveVersion({ APP_VERSION: 'unknown' }, null).version).toBe(UNKNOWN_VERSION);
    expect(resolveVersion({}, null).version).toBe(UNKNOWN_VERSION);
  });

  it('shortens the commit and accepts both variable names', () => {
    expect(resolveVersion({ GIT_SHA: 'A1B2C3D4E5F60718293A4B5C6D7E8F9012345678' }, null).commit).toBe(
      'a1b2c3d4e5f6',
    );
    expect(resolveVersion({ GIT_COMMIT: 'deadbeef' }, null).commit).toBe('deadbeef');
    expect(resolveVersion({}, null).commit).toBeNull();
  });

  it('passes the build date through unchanged', () => {
    expect(resolveVersion({ BUILD_DATE: '2026-08-22T10:00:00Z' }, null).builtAt).toBe('2026-08-22T10:00:00Z');
    expect(resolveVersion({ BUILD_DATE: '' }, null).builtAt).toBeNull();
  });
});

describe('normalizeVersion / shortCommit / versionLabel', () => {
  it('strips the "v" from git tags, never from a name', () => {
    expect(normalizeVersion('v1.2.3')).toBe('1.2.3');
    expect(normalizeVersion('1.2.3')).toBe('1.2.3');
    // `git describe` of a repository with historical uppercase tags.
    expect(normalizeVersion('V1.1.1-573-g7f8c200')).toBe('1.1.1-573-g7f8c200');
    expect(normalizeVersion('vnext')).toBe('vnext');
    expect(normalizeVersion(null)).toBeNull();
  });

  it('caps a non-hexadecimal reference without distorting it', () => {
    expect(shortCommit('branche-de-test')).toBe('branche-de-test');
  });

  it('displays version and commit together', () => {
    expect(versionLabel({ version: '2.1.0', commit: 'abc123def456', builtAt: null })).toBe(
      '2.1.0+abc123def456',
    );
    expect(versionLabel({ version: '2.1.0', commit: null, builtAt: null })).toBe('2.1.0');
  });
});

describe('readPackageVersion', () => {
  it('walks up the tree to the first readable package.json', () => {
    const root = mkdtempSync(join(tmpdir(), 'review-version-'));
    writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '9.9.9' }));
    const deep = join(root, 'dist', 'lib');
    mkdirSync(deep, { recursive: true });
    expect(readPackageVersion(deep)).toBe('9.9.9');
  });

  it('returns null rather than throwing when nothing is found', () => {
    const empty = mkdtempSync(join(tmpdir(), 'review-version-empty-'));
    expect(readPackageVersion(empty, 0)).toBeNull();
  });

  it('ignores an unreadable package.json or one without a version', () => {
    const root = mkdtempSync(join(tmpdir(), 'review-version-bad-'));
    writeFileSync(join(root, 'package.json'), '{ pas du json');
    expect(readPackageVersion(root, 0)).toBeNull();
  });
});

describe('compareSemver', () => {
  it('orders numerically, never lexicographically', () => {
    // The trap that makes an instance believe it is up to date: "2.10.0" < "2.9.0" as text.
    expect(compareSemver('v2.10.0', 'v2.9.0')).toBeGreaterThan(0);
    expect(compareSemver('2.9.0', '2.10.0')).toBeLessThan(0);
    expect(compareSemver('v2.3.0', '2.3.0')).toBe(0);
  });

  it('places a pre-release before the stable version of the same core', () => {
    expect(compareSemver('2.4.0-rc.1', '2.4.0')).toBeLessThan(0);
    expect(compareSemver('2.4.0-rc.1', '2.4.0-rc.2')).toBeLessThan(0);
    expect(compareSemver('2.4.0-rc.2', '2.4.0-rc.10')).toBeLessThan(0);
    expect(compareSemver('2.4.0-alpha', '2.4.0-beta')).toBeLessThan(0);
    // Numeric identifier before alphanumeric identifier, and prefix before extension.
    expect(compareSemver('2.4.0-1', '2.4.0-alpha')).toBeLessThan(0);
    expect(compareSemver('2.4.0-rc.1', '2.4.0-rc.1.2')).toBeLessThan(0);
  });

  it('ignores build metadata', () => {
    expect(compareSemver('2.3.0+abc123', '2.3.0')).toBe(0);
  });

  it('does not throw on a value that is not a version', () => {
    // `install.sh` writes "source" when `git describe` fails; the screen must keep working.
    expect(compareSemver('source', '2.3.0')).toBeLessThan(0);
    expect(compareSemver('0.0.0-unknown', '0.0.1')).toBeLessThan(0);
  });
});

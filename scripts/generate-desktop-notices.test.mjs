// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  licenseFilesIn,
  normalizeCargoLicense,
  renderDesktopNotices,
  shippedPackages,
} from './generate-desktop-notices.mjs';
import { isAllowedLicense } from './generate-notices.mjs';

describe('normalizeCargoLicense', () => {
  it('traduit l’ancienne syntaxe Cargo en expression SPDX', () => {
    expect(normalizeCargoLicense('MIT/Apache-2.0')).toBe('MIT OR Apache-2.0');
    expect(normalizeCargoLicense('Apache-2.0 / MIT')).toBe('Apache-2.0 OR MIT');
    expect(normalizeCargoLicense('MIT OR Apache-2.0')).toBe('MIT OR Apache-2.0');
    expect(normalizeCargoLicense(null)).toBeNull();
  });

  it('les licences des crates Tauri passent la liste blanche', () => {
    for (const expr of [
      '(MIT OR Apache-2.0) AND Unicode-3.0',
      'Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT',
      'MIT OR Apache-2.0 OR LGPL-2.1-or-later',
      'BSD-3-Clause AND MIT',
      'MPL-2.0',
    ]) {
      expect(isAllowedLicense(normalizeCargoLicense(expr))).toBe(true);
    }
    expect(isAllowedLicense('BUSL-1.1')).toBe(false);
  });
});

describe('shippedPackages', () => {
  const pkg = (id) => ({ id, name: id, version: '1.0.0' });
  const dep = (pkgId, kind) => ({ pkg: pkgId, dep_kinds: [{ kind }] });
  const metadata = {
    packages: ['app', 'tauri', 'serde', 'tokio-test', 'build-helper'].map(pkg),
    resolve: {
      root: 'app',
      nodes: [
        { id: 'app', deps: [dep('tauri', null), dep('tokio-test', 'dev'), dep('build-helper', 'build')] },
        { id: 'tauri', deps: [dep('serde', null)] },
        { id: 'serde', deps: [] },
      ],
    },
  };

  it('suit les dépendances normales, sans la racine ni les outils de test ou de build', () => {
    expect(shippedPackages(metadata).map((p) => p.name)).toEqual(['serde', 'tauri']);
  });
});

describe('licenseFilesIn', () => {
  it('reconnaît les noms usuels et ignore le reste', () => {
    expect(
      licenseFilesIn([
        'README.md',
        'LICENSE-MIT',
        'LICENSE-APACHE',
        'COPYING',
        'license.txt',
        'src',
        'NOTICE',
      ]),
    ).toEqual(['COPYING', 'LICENSE-APACHE', 'LICENSE-MIT', 'NOTICE', 'license.txt']);
  });
});

describe('renderDesktopNotices', () => {
  it('liste chaque composant et n’écrit qu’une fois un texte partagé', () => {
    const apache = 'Apache License\r\nVersion 2.0';
    const out = renderDesktopNotices([
      { name: 'a', version: '1.0.0', license: 'Apache-2.0', repository: 'https://x/a', texts: [apache] },
      { name: 'b', version: '2.0.0', license: 'Apache-2.0', repository: null, texts: [apache] },
      { name: 'c', version: '0.1.0', license: 'MIT', repository: null, texts: [] },
    ]);
    expect(out).toContain('- a 1.0.0 — Apache-2.0 — https://x/a');
    expect(out).toContain('Used by: a 1.0.0, b 2.0.0');
    expect(out.match(/Apache License/g)).toHaveLength(1);
    expect(out).toContain('distributed under MIT');
    expect(out).not.toContain('\r');
    expect(out.endsWith('\n')).toBe(true);
  });
});

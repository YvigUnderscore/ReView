// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  collectVendored,
  declaredLicense,
  describeVendored,
  isAllowedLicense,
  lockLicenseIndex,
  packageName,
  productionTree,
  renderNotices,
  renderVendored,
  repositoryUrl,
  resolveEntry,
  vendoredIdsFrom,
  vendoredLicense,
} from './generate-notices.mjs';

/** Minimal lockfile: root → a → b, plus an isolated devDependency and a nested duplicate. */
const lock = {
  packages: {
    '': { name: 'app', dependencies: { a: '^1.0.0' }, devDependencies: { tooling: '^9.0.0' } },
    'node_modules/a': { version: '1.0.0', license: 'MIT', dependencies: { b: '^2.0.0' } },
    'node_modules/a/node_modules/b': { version: '2.9.0', license: 'ISC' },
    'node_modules/b': { version: '2.0.0', license: 'ISC' },
    'node_modules/tooling': { version: '9.0.0', license: 'MIT', dev: true },
  },
};

describe('resolveEntry', () => {
  it('prefers the nested node_modules', () => {
    expect(resolveEntry(lock.packages, 'node_modules/a', 'b')).toBe('node_modules/a/node_modules/b');
  });

  it('goes up to the parent when nothing is nested', () => {
    expect(resolveEntry(lock.packages, 'node_modules/tooling', 'a')).toBe('node_modules/a');
  });

  it('returns null for a missing package', () => {
    expect(resolveEntry(lock.packages, '', 'introuvable')).toBeNull();
  });
});

describe('productionTree', () => {
  it('follows the transitive dependencies from the root', () => {
    expect(productionTree(lock)).toEqual(['node_modules/a', 'node_modules/a/node_modules/b']);
  });

  it('leaves out the devDependencies, never redistributed', () => {
    expect(productionTree(lock)).not.toContain('node_modules/tooling');
  });

  it('supports a lockfile without dependencies', () => {
    expect(productionTree({ packages: { '': {} } })).toEqual([]);
  });
});

describe('packageName', () => {
  it('extracts the name, including nested and scoped', () => {
    expect(packageName('node_modules/a')).toBe('a');
    expect(packageName('node_modules/a/node_modules/b')).toBe('b');
    expect(packageName('node_modules/@scope/pkg')).toBe('@scope/pkg');
  });
});

describe('repositoryUrl', () => {
  it('normalises the usual forms', () => {
    expect(repositoryUrl({ repository: { url: 'git+https://github.com/o/r.git' } })).toBe(
      'https://github.com/o/r',
    );
    expect(repositoryUrl({ repository: 'git://github.com/o/r.git' })).toBe('https://github.com/o/r');
    expect(repositoryUrl({ repository: 'github:o/r' })).toBe('https://github.com/o/r');
  });

  it('returns null when the field is missing', () => {
    expect(repositoryUrl({})).toBeNull();
    expect(repositoryUrl(undefined)).toBeNull();
  });
});

describe('declaredLicense', () => {
  it('reads the string, the object and the historical form', () => {
    expect(declaredLicense({ license: 'MIT' })).toBe('MIT');
    expect(declaredLicense({ license: { type: 'ISC' } })).toBe('ISC');
    expect(declaredLicense({ licenses: [{ type: 'MIT' }, { type: 'Apache-2.0' }] })).toBe(
      'MIT OR Apache-2.0',
    );
  });

  it('returns null when nothing is declared', () => {
    expect(declaredLicense({})).toBeNull();
  });
});

describe('renderNotices', () => {
  const sections = [
    {
      label: 'Backend (Node.js runtime)',
      packages: [
        {
          id: 'a@1.0.0',
          name: 'a',
          version: '1.0.0',
          license: 'MIT',
          repository: 'https://github.com/o/a',
          texts: [{ name: 'LICENSE', text: 'MIT License\nCopyright (c) 2020 Someone' }],
        },
        {
          id: 'b@2.0.0',
          name: 'b',
          version: '2.0.0',
          license: 'ISC',
          repository: null,
          texts: null,
        },
      ],
    },
  ];

  it('summarises the licences and the total', () => {
    const out = renderNotices(sections);
    expect(out).toContain('| MIT | 1 |');
    expect(out).toContain('| ISC | 1 |');
    expect(out).toContain('| **Total** | **2** |');
  });

  it('recalls the project licence and the aggregation of the services', () => {
    const out = renderNotices(sections);
    expect(out).toContain('GNU Affero General Public License');
    expect(out).toContain('FFmpeg (GPL-2.0-or-later, Debian build)');
  });

  it('includes the verbatim licence text of each package', () => {
    expect(renderNotices(sections)).toContain('Copyright (c) 2020 Someone');
  });

  it('explicitly reports a package without a licence file', () => {
    expect(renderNotices(sections)).toContain('No license file shipped');
  });

  it('lengthens the fence when the text already contains backticks', () => {
    const withTicks = [
      {
        label: 'Backend (Node.js runtime)',
        packages: [
          {
            id: 'c@1.0.0',
            name: 'c',
            version: '1.0.0',
            license: 'MIT',
            repository: null,
            texts: [{ name: 'LICENSE', text: 'voir ```code``` ici' }],
          },
        ],
      },
    ];
    expect(renderNotices(withTicks)).toContain('````text');
  });

  it('produces deterministic output', () => {
    expect(renderNotices(sections)).toBe(renderNotices(sections));
  });

  it('adds the internal-copies chapter without touching what precedes it', () => {
    const vendored = [
      { id: 'js-yaml@4.1.1', workspace: 'frontend', hosts: ['mermaid'], license: 'MIT', basis: 'x' },
    ];
    const withVendored = renderNotices(sections, vendored);
    expect(withVendored).toContain('## Vendored third-party code');
    expect(withVendored).toContain('js-yaml@4.1.1');
    expect(withVendored.startsWith(renderNotices(sections).trimEnd())).toBe(true);
  });
});

describe('isAllowedLicense', () => {
  it('accepts the permissive licences found in the production tree', () => {
    for (const id of ['MIT', 'Apache-2.0', 'ISC', 'BSD-3-Clause', '0BSD', 'MPL-2.0', 'OFL-1.1']) {
      expect(isAllowedLicense(id)).toBe(true);
    }
  });

  it('requires both branches of an AND to be acceptable', () => {
    expect(isAllowedLicense('(MIT AND Zlib)')).toBe(true);
    expect(isAllowedLicense('(MIT AND SSPL-1.0)')).toBe(false);
  });

  it('is satisfied with one acceptable branch in an OR', () => {
    expect(isAllowedLicense('(MPL-2.0 OR Apache-2.0)')).toBe(true);
    expect(isAllowedLicense('(SSPL-1.0 OR MIT)')).toBe(true);
    expect(isAllowedLicense('(SSPL-1.0 OR BUSL-1.1)')).toBe(false);
  });

  it('ignores the exception of a WITH and judges the licence it accompanies', () => {
    expect(isAllowedLicense('Apache-2.0 WITH LLVM-exception')).toBe(true);
    expect(isAllowedLicense('SSPL-1.0 WITH whatever-exception')).toBe(false);
  });

  it('refuses source-available, copyleft "only" and a missing licence', () => {
    for (const id of ['SSPL-1.0', 'BUSL-1.1', 'Elastic-2.0', 'GPL-2.0-only', 'UNKNOWN', 'UNLICENSED']) {
      expect(isAllowedLicense(id)).toBe(false);
    }
    expect(isAllowedLicense('')).toBe(false);
    expect(isAllowedLicense(null)).toBe(false);
  });

  it('treats the + suffix as "or later"', () => {
    expect(isAllowedLicense('GPL-2.0+')).toBe(true);
    expect(isAllowedLicense('SSPL-1.0+')).toBe(false);
  });

  it('rejects a malformed expression rather than accepting it half-way', () => {
    expect(isAllowedLicense('(MIT')).toBe(false);
    expect(isAllowedLicense('MIT)')).toBe(false);
    expect(isAllowedLicense('MIT AND')).toBe(false);
  });
});

describe('vendoredIdsFrom', () => {
  it('spots the copied module behind the bundler marker', () => {
    // Real shape found in mermaid: the js-yaml 4.1.1 code is copied as is.
    const code =
      'var require_js_yaml = __commonJS({"../node_modules/.pnpm/js-yaml@4.1.1/node_modules/js-yaml/dist/js-yaml.mjs"(e){}});';
    expect([...vendoredIdsFrom(code)]).toEqual(['js-yaml@4.1.1']);
  });

  it('understands the pnpm spelling of a scoped package (`@a+b` in the store)', () => {
    const code = '"/.pnpm/@scope+pkg@2.3.0/node_modules/@scope/pkg/index.js"';
    expect([...vendoredIdsFrom(code)]).toEqual(['@scope/pkg@2.3.0']);
  });

  it('tolerates the peer suffix of pnpm installations', () => {
    const code = '"/.pnpm/foo@1.2.3_bar@2.0.0/node_modules/foo/lib/x.js"';
    expect([...vendoredIdsFrom(code)]).toEqual(['foo@1.2.3']);
  });

  it('does not keep a path that designates another package than the folder one', () => {
    // `.pnpm/a@1.0.0/node_modules/b/`: b is not copied, it is simply resolved
    // from a's folder. Confusing the two would invent components.
    expect([...vendoredIdsFrom('"/.pnpm/a@1.0.0/node_modules/b/index.js"')]).toEqual([]);
  });

  it('sets aside a path without a version, which cannot be attributed', () => {
    expect([...vendoredIdsFrom('"../node_modules/lodash/index.js"')]).toEqual([]);
  });
});

describe('collectVendored', () => {
  const dirs = [];
  afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });

  /** Mini workspace on disk: one production package and its shipped files. */
  const makeWorkspace = (packages, files) => {
    const root = mkdtempSync(path.join(tmpdir(), 'review-notices-'));
    dirs.push(root);
    mkdirSync(path.join(root, 'ws'), { recursive: true });
    for (const [rel, content] of Object.entries(files)) {
      const full = path.join(root, 'ws', rel);
      mkdirSync(path.dirname(full), { recursive: true });
      writeFileSync(full, content);
    }
    return { root, lock: { packages } };
  };

  const marker = (id, name) => `__commonJS({"../node_modules/.pnpm/${id}/node_modules/${name}/i.js"(){}});`;

  it('counts the internal copies of the package, including the one the lockfile does not see', async () => {
    const { root, lock } = makeWorkspace(
      {
        '': { dependencies: { host: '^1.0.0' } },
        'node_modules/host': { version: '1.0.0', license: 'MIT' },
        // js-yaml only exists in the lockfile as 4.3.1, pulled in by a tool
        // of development: the 4.1.1 copy copied into `host` nevertheless ships to production.
        'node_modules/js-yaml': { version: '4.3.1', license: 'MIT', dev: true },
      },
      {
        'node_modules/host/dist/bundle.js': `${marker('js-yaml@4.1.1', 'js-yaml')}\n${marker('execa@5.1.1', 'execa')}`,
        'node_modules/host/dist/bundle.js.map': marker('never-seen@9.9.9', 'never-seen'),
        'node_modules/host/node_modules/nested/index.js': marker('deep@1.0.0', 'deep'),
      },
    );
    const found = await collectVendored(root, { dir: 'ws' }, lock, productionTree(lock));
    expect([...found.keys()].sort()).toEqual(['execa@5.1.1', 'js-yaml@4.1.1']);
    expect([...found.get('js-yaml@4.1.1')]).toEqual(['host']);
  });

  it('ne redit pas ce qui est déjà attribué : même paquet, même version dans l’arbre', async () => {
    const { root, lock } = makeWorkspace(
      {
        '': { dependencies: { host: '^1.0.0', dep: '^2.0.0' } },
        'node_modules/host': { version: '1.0.0', license: 'MIT' },
        'node_modules/dep': { version: '2.0.0', license: 'MIT' },
      },
      { 'node_modules/host/index.js': marker('dep@2.0.0', 'dep') },
    );
    const found = await collectVendored(root, { dir: 'ws' }, lock, productionTree(lock));
    expect([...found.keys()]).toEqual([]);
  });

  it('saute les paquets propres à une plateforme, dont le contenu varie d’une machine à l’autre', async () => {
    const { root, lock } = makeWorkspace(
      {
        '': { dependencies: { host: '^1.0.0' } },
        'node_modules/host': { version: '1.0.0', license: 'MIT', os: ['win32'], cpu: ['x64'] },
      },
      { 'node_modules/host/index.js': marker('execa@5.1.1', 'execa') },
    );
    const found = await collectVendored(root, { dir: 'ws' }, lock, productionTree(lock));
    expect([...found.keys()]).toEqual([]);
  });
});

describe('vendoredLicense', () => {
  const index = lockLicenseIndex([
    {
      packages: {
        'node_modules/js-yaml': { version: '4.3.1', license: 'MIT' },
        'node_modules/exact': { version: '1.0.0', license: 'ISC' },
        'node_modules/mixed': { version: '1.0.0', license: 'MIT' },
        'node_modules/a/node_modules/mixed': { version: '2.0.0', license: 'GPL-3.0-only' },
      },
    },
  ]);

  it('retient la licence de la version exacte quand le lockfile la porte', () => {
    expect(vendoredLicense('exact@1.0.0', index)).toEqual({
      license: 'ISC',
      basis: 'same version in a lockfile',
    });
  });

  it('se rabat sur les autres versions du paquet quand elles s’accordent, et le dit', () => {
    const got = vendoredLicense('js-yaml@4.1.1', index);
    expect(got.license).toBe('MIT');
    expect(got.basis).toBe('other versions of the package, all agreeing');
  });

  it('refuse de trancher quand les versions connues divergent', () => {
    expect(vendoredLicense('mixed@3.0.0', index).license).toBeNull();
  });

  it('refuse de trancher pour un paquet qu’aucun lockfile ne connaît', () => {
    expect(vendoredLicense('execa@5.1.1', index)).toEqual({ license: null, basis: 'not determined' });
  });
});

describe('renderVendored', () => {
  const vendored = describeVendored(
    new Map([
      ['js-yaml@4.1.1', new Set(['mermaid'])],
      ['execa@5.1.1', new Set(['@prisma/fetch-engine', '@prisma/get-platform'])],
    ]),
    lockLicenseIndex([{ packages: { 'node_modules/js-yaml': { version: '4.3.1', license: 'MIT' } } }]),
    'frontend',
  );

  it('nomme chaque copie et le paquet qui la transporte', () => {
    const out = renderVendored(vendored);
    expect(out.join('\n')).toContain('`js-yaml@4.1.1` | `mermaid` (frontend)');
    expect(out.join('\n')).toContain('`@prisma/fetch-engine`, `@prisma/get-platform`');
  });

  it('marque « unverified » ce qu’il n’a pas pu établir au lieu de le taire', () => {
    const text = renderVendored(vendored).join('\n');
    expect(text).toContain('**unverified**');
    expect(text).toContain('2 copies, 1 of which with no license established.');
  });

  it('annonce sa propre limite : la liste n’est pas une preuve d’exhaustivité', () => {
    expect(renderVendored(vendored).join('\n')).toContain('not a proof of completeness');
  });

  it('ne pose aucun chapitre quand rien n’a été recopié', () => {
    expect(renderVendored([])).toEqual([]);
  });
});

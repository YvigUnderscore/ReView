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

/** Lockfile minimal : racine → a → b, plus une devDependency isolée et un doublon imbriqué. */
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
  it('préfère le node_modules imbriqué', () => {
    expect(resolveEntry(lock.packages, 'node_modules/a', 'b')).toBe('node_modules/a/node_modules/b');
  });

  it('remonte vers le parent quand rien n’est imbriqué', () => {
    expect(resolveEntry(lock.packages, 'node_modules/tooling', 'a')).toBe('node_modules/a');
  });

  it('rend null pour un paquet absent', () => {
    expect(resolveEntry(lock.packages, '', 'introuvable')).toBeNull();
  });
});

describe('productionTree', () => {
  it('suit les dépendances transitives depuis la racine', () => {
    expect(productionTree(lock)).toEqual(['node_modules/a', 'node_modules/a/node_modules/b']);
  });

  it('écarte les devDependencies, jamais redistribuées', () => {
    expect(productionTree(lock)).not.toContain('node_modules/tooling');
  });

  it('supporte un lockfile sans dépendances', () => {
    expect(productionTree({ packages: { '': {} } })).toEqual([]);
  });
});

describe('packageName', () => {
  it('extrait le nom, y compris imbriqué et scopé', () => {
    expect(packageName('node_modules/a')).toBe('a');
    expect(packageName('node_modules/a/node_modules/b')).toBe('b');
    expect(packageName('node_modules/@scope/pkg')).toBe('@scope/pkg');
  });
});

describe('repositoryUrl', () => {
  it('normalise les formes usuelles', () => {
    expect(repositoryUrl({ repository: { url: 'git+https://github.com/o/r.git' } })).toBe(
      'https://github.com/o/r',
    );
    expect(repositoryUrl({ repository: 'git://github.com/o/r.git' })).toBe('https://github.com/o/r');
    expect(repositoryUrl({ repository: 'github:o/r' })).toBe('https://github.com/o/r');
  });

  it('rend null quand le champ manque', () => {
    expect(repositoryUrl({})).toBeNull();
    expect(repositoryUrl(undefined)).toBeNull();
  });
});

describe('declaredLicense', () => {
  it('lit la chaîne, l’objet et la forme historique', () => {
    expect(declaredLicense({ license: 'MIT' })).toBe('MIT');
    expect(declaredLicense({ license: { type: 'ISC' } })).toBe('ISC');
    expect(declaredLicense({ licenses: [{ type: 'MIT' }, { type: 'Apache-2.0' }] })).toBe(
      'MIT OR Apache-2.0',
    );
  });

  it('rend null quand rien n’est déclaré', () => {
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

  it('récapitule les licences et le total', () => {
    const out = renderNotices(sections);
    expect(out).toContain('| MIT | 1 |');
    expect(out).toContain('| ISC | 1 |');
    expect(out).toContain('| **Total** | **2** |');
  });

  it('rappelle la licence du projet et l’agrégation des services', () => {
    const out = renderNotices(sections);
    expect(out).toContain('GNU Affero General Public License');
    expect(out).toContain('FFmpeg (GPL-2.0-or-later, Debian build)');
  });

  it('inclut le texte de licence verbatim de chaque paquet', () => {
    expect(renderNotices(sections)).toContain('Copyright (c) 2020 Someone');
  });

  it('signale explicitement un paquet sans fichier de licence', () => {
    expect(renderNotices(sections)).toContain('No license file shipped');
  });

  it('allonge la clôture quand le texte contient déjà des backticks', () => {
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

  it('produit une sortie déterministe', () => {
    expect(renderNotices(sections)).toBe(renderNotices(sections));
  });

  it('ajoute le chapitre des copies internes sans toucher à ce qui précède', () => {
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
  it('accepte les licences permissives rencontrées dans l’arbre de production', () => {
    for (const id of ['MIT', 'Apache-2.0', 'ISC', 'BSD-3-Clause', '0BSD', 'MPL-2.0', 'OFL-1.1']) {
      expect(isAllowedLicense(id)).toBe(true);
    }
  });

  it('exige que les deux branches d’un AND soient acceptables', () => {
    expect(isAllowedLicense('(MIT AND Zlib)')).toBe(true);
    expect(isAllowedLicense('(MIT AND SSPL-1.0)')).toBe(false);
  });

  it('se contente d’une branche acceptable dans un OR', () => {
    expect(isAllowedLicense('(MPL-2.0 OR Apache-2.0)')).toBe(true);
    expect(isAllowedLicense('(SSPL-1.0 OR MIT)')).toBe(true);
    expect(isAllowedLicense('(SSPL-1.0 OR BUSL-1.1)')).toBe(false);
  });

  it('ignore l’exception d’un WITH et juge la licence qu’elle accompagne', () => {
    expect(isAllowedLicense('Apache-2.0 WITH LLVM-exception')).toBe(true);
    expect(isAllowedLicense('SSPL-1.0 WITH whatever-exception')).toBe(false);
  });

  it('refuse le source-available, le copyleft « only » et l’absence de licence', () => {
    for (const id of ['SSPL-1.0', 'BUSL-1.1', 'Elastic-2.0', 'GPL-2.0-only', 'UNKNOWN', 'UNLICENSED']) {
      expect(isAllowedLicense(id)).toBe(false);
    }
    expect(isAllowedLicense('')).toBe(false);
    expect(isAllowedLicense(null)).toBe(false);
  });

  it('traite le suffixe + comme un « or later »', () => {
    expect(isAllowedLicense('GPL-2.0+')).toBe(true);
    expect(isAllowedLicense('SSPL-1.0+')).toBe(false);
  });

  it('rejette une expression mal formée plutôt que de l’accepter à moitié', () => {
    expect(isAllowedLicense('(MIT')).toBe(false);
    expect(isAllowedLicense('MIT)')).toBe(false);
    expect(isAllowedLicense('MIT AND')).toBe(false);
  });
});

describe('vendoredIdsFrom', () => {
  it('repère le module recopié derrière le marqueur du bundler', () => {
    // Forme réelle trouvée dans mermaid : le code de js-yaml 4.1.1 est recopié tel quel.
    const code =
      'var require_js_yaml = __commonJS({"../node_modules/.pnpm/js-yaml@4.1.1/node_modules/js-yaml/dist/js-yaml.mjs"(e){}});';
    expect([...vendoredIdsFrom(code)]).toEqual(['js-yaml@4.1.1']);
  });

  it('comprend la graphie pnpm d’un paquet scopé (`@a+b` côté magasin)', () => {
    const code = '"/.pnpm/@scope+pkg@2.3.0/node_modules/@scope/pkg/index.js"';
    expect([...vendoredIdsFrom(code)]).toEqual(['@scope/pkg@2.3.0']);
  });

  it('tolère le suffixe de pairs des installations pnpm', () => {
    const code = '"/.pnpm/foo@1.2.3_bar@2.0.0/node_modules/foo/lib/x.js"';
    expect([...vendoredIdsFrom(code)]).toEqual(['foo@1.2.3']);
  });

  it('ne retient pas un chemin qui désigne un autre paquet que celui du dossier', () => {
    // `.pnpm/a@1.0.0/node_modules/b/` : b n'est pas recopié, il est simplement résolu
    // depuis le dossier de a. Le confondre inventerait des composants.
    expect([...vendoredIdsFrom('"/.pnpm/a@1.0.0/node_modules/b/index.js"')]).toEqual([]);
  });

  it('laisse de côté un chemin sans version, inattribuable', () => {
    expect([...vendoredIdsFrom('"../node_modules/lodash/index.js"')]).toEqual([]);
  });
});

describe('collectVendored', () => {
  const dirs = [];
  afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });

  /** Mini-workspace sur disque : un paquet de production et ses fichiers livrés. */
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

  it('compte les copies internes du paquet, y compris celle que le lockfile ne voit pas', async () => {
    const { root, lock } = makeWorkspace(
      {
        '': { dependencies: { host: '^1.0.0' } },
        'node_modules/host': { version: '1.0.0', license: 'MIT' },
        // js-yaml n'existe dans le lockfile qu'en 4.3.1, tiré par un outil de
        // développement : la copie 4.1.1 recopiée dans `host` part pourtant en production.
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

// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  declaredLicense,
  isAllowedLicense,
  packageName,
  productionTree,
  renderNotices,
  repositoryUrl,
  resolveEntry,
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

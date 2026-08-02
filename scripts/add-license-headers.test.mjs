// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  COPYRIGHT,
  LICENSE_ID,
  commentPrefix,
  detectEol,
  hasHeader,
  withHeader,
} from './add-license-headers.mjs';

const CR = String.fromCharCode(13);
const LF = String.fromCharCode(10);
const CRLF = CR + LF;
const HEADER_LF = `// ${COPYRIGHT}${LF}// ${LICENSE_ID}${LF}`;

describe('commentPrefix', () => {
  it('rend // pour les sources JS/TS', () => {
    for (const ext of ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']) {
      expect(commentPrefix(ext)).toBe('//');
    }
  });

  it('rend # pour les scripts shell', () => {
    expect(commentPrefix('.sh')).toBe('#');
  });

  it('rend null pour un type non couvert', () => {
    expect(commentPrefix('.md')).toBeNull();
    expect(commentPrefix('.sql')).toBeNull();
  });
});

describe('detectEol', () => {
  it('reconnaît CRLF et LF', () => {
    expect(detectEol(`a${CRLF}b`)).toBe(CRLF);
    expect(detectEol(`a${LF}b`)).toBe(LF);
  });
});

describe('hasHeader', () => {
  it('détecte un en-tête présent', () => {
    expect(hasHeader(`${HEADER_LF}${LF}const a = 1;${LF}`)).toBe(true);
  });

  it('ignore une mention située trop bas dans le fichier', () => {
    expect(hasHeader(`${LF.repeat(20)}// ${LICENSE_ID}${LF}`)).toBe(false);
  });

  it('rend false sur un fichier nu', () => {
    expect(hasHeader(`const a = 1;${LF}`)).toBe(false);
  });
});

describe('withHeader', () => {
  it('préfixe un fichier TypeScript et laisse une ligne vide', () => {
    expect(withHeader(`import x from 'y';${LF}`, '.ts')).toBe(
      `${HEADER_LF}${LF}import x from 'y';${LF}`,
    );
  });

  it('est idempotent', () => {
    const once = withHeader(`import x from 'y';${LF}`, '.ts');
    expect(withHeader(once, '.ts')).toBe(once);
  });

  it('préserve les fins de ligne CRLF sans introduire de LF isolé', () => {
    const out = withHeader(`import x from 'y';${CRLF}`, '.ts');
    expect(out).toBe(`// ${COPYRIGHT}${CRLF}// ${LICENSE_ID}${CRLF}${CRLF}import x from 'y';${CRLF}`);
    expect(/(?<!\r)\n/.test(out)).toBe(false);
  });

  it('glisse l’en-tête sous le shebang', () => {
    const out = withHeader(`#!/usr/bin/env bash${LF}set -e${LF}`, '.sh');
    expect(out).toBe(`#!/usr/bin/env bash${LF}# ${COPYRIGHT}${LF}# ${LICENSE_ID}${LF}${LF}set -e${LF}`);
    expect(out.startsWith('#!')).toBe(true);
  });

  it('ne double pas la ligne vide quand le fichier commence déjà par une', () => {
    expect(withHeader(`${LF}const a = 1;${LF}`, '.ts')).toBe(`${HEADER_LF}${LF}const a = 1;${LF}`);
  });

  it('laisse intact un type de fichier non couvert', () => {
    expect(withHeader(`# Titre${LF}`, '.md')).toBe(`# Titre${LF}`);
  });
});

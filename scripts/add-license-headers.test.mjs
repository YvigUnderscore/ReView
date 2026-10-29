// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  COPYRIGHT,
  LICENSE_ID,
  commentPrefix,
  commentSuffix,
  detectEol,
  hasHeader,
  withHeader,
} from './add-license-headers.mjs';

const CR = String.fromCharCode(13);
const LF = String.fromCharCode(10);
const CRLF = CR + LF;
const HEADER_LF = `// ${COPYRIGHT}${LF}// ${LICENSE_ID}${LF}`;

describe('commentPrefix', () => {
  it('returns // for JS/TS sources', () => {
    for (const ext of ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']) {
      expect(commentPrefix(ext)).toBe('//');
    }
  });

  it('returns # for shell and Python scripts', () => {
    expect(commentPrefix('.sh')).toBe('#');
    expect(commentPrefix('.py')).toBe('#');
  });

  it('returns // for the Prisma schema', () => {
    expect(commentPrefix('.prisma')).toBe('//');
  });

  it('returns /* for stylesheets', () => {
    expect(commentPrefix('.css')).toBe('/*');
  });

  it('returns null for an uncovered type', () => {
    expect(commentPrefix('.md')).toBeNull();
    expect(commentPrefix('.sql')).toBeNull();
  });
});

describe('commentSuffix', () => {
  it('closes the block comment of stylesheets', () => {
    expect(commentSuffix('.css')).toBe(' */');
  });

  it('stays empty for line comments', () => {
    for (const ext of ['.ts', '.sh', '.py', '.prisma']) expect(commentSuffix(ext)).toBe('');
  });
});

describe('detectEol', () => {
  it('recognises CRLF and LF', () => {
    expect(detectEol(`a${CRLF}b`)).toBe(CRLF);
    expect(detectEol(`a${LF}b`)).toBe(LF);
  });
});

describe('hasHeader', () => {
  it('detects a header that is present', () => {
    expect(hasHeader(`${HEADER_LF}${LF}const a = 1;${LF}`)).toBe(true);
  });

  it('ignores a mention located too low in the file', () => {
    expect(hasHeader(`${LF.repeat(20)}// ${LICENSE_ID}${LF}`)).toBe(false);
  });

  it('returns false on a bare file', () => {
    expect(hasHeader(`const a = 1;${LF}`)).toBe(false);
  });
});

describe('withHeader', () => {
  it('prefixes a TypeScript file and leaves a blank line', () => {
    expect(withHeader(`import x from 'y';${LF}`, '.ts')).toBe(`${HEADER_LF}${LF}import x from 'y';${LF}`);
  });

  it('is idempotent', () => {
    const once = withHeader(`import x from 'y';${LF}`, '.ts');
    expect(withHeader(once, '.ts')).toBe(once);
  });

  it('preserves CRLF line endings without introducing a lone LF', () => {
    const out = withHeader(`import x from 'y';${CRLF}`, '.ts');
    expect(out).toBe(`// ${COPYRIGHT}${CRLF}// ${LICENSE_ID}${CRLF}${CRLF}import x from 'y';${CRLF}`);
    expect(/(?<!\r)\n/.test(out)).toBe(false);
  });

  it('slides the header under the shebang', () => {
    const out = withHeader(`#!/usr/bin/env bash${LF}set -e${LF}`, '.sh');
    expect(out).toBe(`#!/usr/bin/env bash${LF}# ${COPYRIGHT}${LF}# ${LICENSE_ID}${LF}${LF}set -e${LF}`);
    expect(out.startsWith('#!')).toBe(true);
  });

  it('closes the block comment on a stylesheet', () => {
    expect(withHeader(`@tailwind base;${LF}`, '.css')).toBe(
      `/* ${COPYRIGHT} */${LF}/* ${LICENSE_ID} */${LF}${LF}@tailwind base;${LF}`,
    );
  });

  it('slides the header under the shebang of a Python script', () => {
    const out = withHeader(`#!/usr/bin/env python3${LF}import sys${LF}`, '.py');
    expect(out).toBe(
      `#!/usr/bin/env python3${LF}# ${COPYRIGHT}${LF}# ${LICENSE_ID}${LF}${LF}import sys${LF}`,
    );
  });

  it('does not double the blank line when the file already starts with one', () => {
    expect(withHeader(`${LF}const a = 1;${LF}`, '.ts')).toBe(`${HEADER_LF}${LF}const a = 1;${LF}`);
  });

  it('leaves an uncovered file type intact', () => {
    expect(withHeader(`# Titre${LF}`, '.md')).toBe(`# Titre${LF}`);
  });
});

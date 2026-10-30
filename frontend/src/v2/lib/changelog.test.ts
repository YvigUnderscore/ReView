// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { parseChangelog } from './changelog';

describe('parseChangelog (42.B №68)', () => {
  it('splits into entries by level-2 heading, most recent first', () => {
    const md = `# Changelog\n\nIntro ignorée.\n\n## 2026-07 — Récent\n\n- a\n- b\n\n## 2026-06 — Ancien\n\n- c\n`;
    const entries = parseChangelog(md);
    expect(entries.map((e) => e.id)).toEqual(['2026-07 — Récent', '2026-06 — Ancien']);
    expect(entries[0].body).toBe('- a\n- b');
    expect(entries[1].body).toBe('- c');
  });

  it('ignores the content before the first level-2 heading', () => {
    expect(parseChangelog('# Titre\n\ntexte\n')).toEqual([]);
  });

  it('handles an entry without a body', () => {
    const entries = parseChangelog('## Vide\n');
    expect(entries).toEqual([{ id: 'Vide', body: '' }]);
  });
});

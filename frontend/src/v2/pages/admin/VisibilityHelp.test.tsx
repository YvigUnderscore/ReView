// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import VisibilityHelp from './VisibilityHelp';
import { MATCH_EFFECT, MATCH_EXAMPLE, MATCH_LABEL } from './visibilityLabels';
import { t } from '../../i18n';

/**
 * The pattern help is the only place where an admin learns to write a regular
 * expression for this studio. Two invariants: it is collapsed at start (it must not clutter
 * those who know), and its four examples really exist in the
 * catalogues — a missing key would show up there as an empty label, not as an error.
 */
describe('VisibilityHelp', () => {
  it('is collapsed on first render', () => {
    const html = renderToStaticMarkup(<VisibilityHelp />);
    expect(html).toContain('aria-expanded="false"');
    // The content is not merely hidden: it is not rendered at all.
    expect(html).not.toContain(t(MATCH_EXAMPLE.regex));
  });

  it('announces what it contains, even when collapsed', () => {
    expect(renderToStaticMarkup(<VisibilityHelp />)).toContain(t('visibility.help.title'));
  });
});

describe('visibilityLabels — all keys exist', () => {
  it('names the four pattern forms and their example', () => {
    for (const kind of ['exact', 'prefix', 'contains', 'regex'] as const) {
      // `t()` returns the key itself when it is missing: comparing against the key detects it.
      expect(t(MATCH_LABEL[kind])).not.toBe(MATCH_LABEL[kind]);
      expect(t(MATCH_EXAMPLE[kind])).not.toBe(MATCH_EXAMPLE[kind]);
      expect(t(MATCH_EFFECT[kind])).not.toBe(MATCH_EFFECT[kind]);
    }
  });

  it('explains regular-expression syntax, not just its name', () => {
    // This is the promise made to the user: "briefly explaining how to do it".
    const effect = t(MATCH_EFFECT.regex);
    expect(effect).toContain('$');
    expect(effect).toContain('|');
  });
});

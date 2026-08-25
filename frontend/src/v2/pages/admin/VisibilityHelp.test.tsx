// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import VisibilityHelp from './VisibilityHelp';
import { MATCH_EFFECT, MATCH_EXAMPLE, MATCH_LABEL } from './visibilityLabels';
import { t } from '../../i18n';

/**
 * L'aide aux motifs est le seul endroit où un admin apprend à écrire une expression
 * régulière pour ce studio. Deux invariants : elle est repliée au départ (elle ne doit pas
 * encombrer ceux qui savent), et ses quatre exemples existent réellement dans les
 * catalogues — une clé manquante s'y verrait comme un libellé vide, pas comme une erreur.
 */
describe('VisibilityHelp', () => {
  it('est repliée au premier rendu', () => {
    const html = renderToStaticMarkup(<VisibilityHelp />);
    expect(html).toContain('aria-expanded="false"');
    // Le contenu n'est pas seulement caché : il n'est pas rendu du tout.
    expect(html).not.toContain(t(MATCH_EXAMPLE.regex));
  });

  it('annonce ce qu’elle contient, même repliée', () => {
    expect(renderToStaticMarkup(<VisibilityHelp />)).toContain(t('visibility.help.title'));
  });
});

describe('visibilityLabels — les clés existent toutes', () => {
  it('nomme les quatre formes de motif et leur exemple', () => {
    for (const kind of ['exact', 'prefix', 'contains', 'regex'] as const) {
      // `t()` rend la clé elle-même quand elle manque : comparer à la clé le détecte.
      expect(t(MATCH_LABEL[kind])).not.toBe(MATCH_LABEL[kind]);
      expect(t(MATCH_EXAMPLE[kind])).not.toBe(MATCH_EXAMPLE[kind]);
      expect(t(MATCH_EFFECT[kind])).not.toBe(MATCH_EFFECT[kind]);
    }
  });

  it('explique bien la syntaxe des expressions régulières, pas seulement leur nom', () => {
    // C'est la promesse faite à l'utilisateur : « en expliquant brièvement comment faire ».
    const effect = t(MATCH_EFFECT.regex);
    expect(effect).toContain('$');
    expect(effect).toContain('|');
  });
});

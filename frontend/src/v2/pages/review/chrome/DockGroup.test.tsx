// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Group, Row } from './DockGroup';
import { DOCK_GROUP_COLLAPSE_THRESHOLD, isLongDockGroup } from './dockGroupSize';
import { t } from '../../../i18n';

/**
 * Repli des groupes du dock (Phase 50, lot 6). Aucun groupe ne l'était : le panneau Infos
 * d'une scène USD riche se parcourait à l'ascenseur, et un groupe court — les quatre mesures
 * de la frame courante — passait hors champ.
 *
 * Ce qui est vérifié : le seuil, le repli d'office au-delà, le fait qu'un groupe replié cache
 * bien son contenu tout en gardant son décompte, et que l'action d'en-tête (enregistrer une
 * vue, armer la mesure) reste atteignable dans les deux états — elle ne vit pas dans le
 * déclencheur du repli.
 *
 * S'y ajoute (lot 15) le contrat de hauteur de la rangée, qui ne se lit ni dans le DOM ni dans
 * TypeScript : les classes du dock vivent dans une feuille que vitest ne charge pas, et
 * happy-dom ne met rien en page. La feuille est donc lue comme un texte — c'est une preuve de
 * structure, pas de rendu.
 */

// Vitest s'exécute depuis `frontend/` (cf. vitest.config.ts), comme pour les tokens du thème.
const CHROME_CSS = readFileSync(resolve(process.cwd(), 'src/v2/pages/review/chrome/chrome.css'), 'utf8');

/** Corps d'une règle, sélecteur exact : `.rv-row` ne ramène pas `.rv-row--stack`. */
function ruleOf(selector: string): string {
  // Le sélecteur est cherché en début de ligne : sinon `.rv-row` tomberait sur `.rv-row__label`.
  const start = CHROME_CSS.indexOf(`\n${selector} {`);
  expect(start, `règle ${selector} introuvable dans chrome.css`).toBeGreaterThan(-1);
  const open = CHROME_CSS.indexOf('{', start);
  return CHROME_CSS.slice(open, CHROME_CSS.indexOf('}', open));
}

describe('isLongDockGroup', () => {
  it('ne déclare long qu’au-delà du seuil', () => {
    expect(isLongDockGroup(DOCK_GROUP_COLLAPSE_THRESHOLD)).toBe(false);
    expect(isLongDockGroup(DOCK_GROUP_COLLAPSE_THRESHOLD + 1)).toBe(true);
    expect(isLongDockGroup(0)).toBe(false);
  });
});

describe('Group', () => {
  it('reste un simple titre quand il n’est pas repliable', () => {
    render(<Group title="Technical sheet">contenu</Group>);
    expect(screen.getByText('contenu')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('se replie et se déplie au clic sur son titre', () => {
    render(
      <Group title="Textures" collapsible>
        contenu
      </Group>,
    );
    const toggle = screen.getByRole('button', { name: /Textures/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('contenu')).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('contenu')).not.toBeInTheDocument();
    expect(toggle).toHaveAttribute('title', t('review.dock.group.expand'));

    fireEvent.click(toggle);
    expect(screen.getByText('contenu')).toBeInTheDocument();
    expect(toggle).toHaveAttribute('title', t('review.dock.group.collapse'));
  });

  it('arrive replié quand on le lui demande, en gardant son décompte visible', () => {
    render(
      <Group title="Textures" collapsible defaultCollapsed count={12}>
        contenu
      </Group>,
    );
    expect(screen.queryByText('contenu')).not.toBeInTheDocument();
    // Le décompte est ce qui permet de savoir si le groupe fermé mérite un clic.
    expect(screen.getByRole('button', { name: /12/ })).toBeInTheDocument();
  });

  it('ne replie rien sans `collapsible`, même avec `defaultCollapsed`', () => {
    // Le repli d'office est une conséquence du repli, pas une façon de masquer un groupe.
    render(
      <Group title="Live render" defaultCollapsed>
        contenu
      </Group>,
    );
    expect(screen.getByText('contenu')).toBeInTheDocument();
  });

  it('laisse l’action d’en-tête cliquable, groupe replié comme déplié', () => {
    render(
      <Group title="Measurements" collapsible defaultCollapsed action={<button>Ruler</button>}>
        contenu
      </Group>,
    );
    expect(screen.getByRole('button', { name: 'Ruler' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Measurements/ }));
    expect(screen.getByRole('button', { name: 'Ruler' })).toBeInTheDocument();
    expect(screen.getByText('contenu')).toBeInTheDocument();
  });
});

describe('Row', () => {
  it('porte les classes qui tiennent sa hauteur, et son indice en infobulle', () => {
    render(
      <Row label="Purpose" hint="/World/Chair" stack>
        <input aria-label="ctl" />
      </Row>,
    );
    const row = screen.getByText('Purpose').parentElement;
    // C'est par ces classes que le contrat de la feuille s'applique à ce qui est rendu.
    expect(row?.className.split(' ')).toContain('rv-row');
    expect(row?.className.split(' ')).toContain('rv-row--stack');
    expect(row).toHaveAttribute('title', '/World/Chair');
  });

  it('refuse d’être comprimée sous sa hauteur naturelle', () => {
    const rule = ruleOf('.rv-row');
    // La hauteur minimale EXPLICITE remplace la taille minimale automatique du flex : sans
    // `flex-shrink: 0`, une rangée posée dans une colonne bornée (`max-h-*` +
    // `overflow-y-auto`, cf. la recomposition USD) retombe à ce pas, son contenu empilé se
    // peint sur la rangée voisine, et la colonne n'a plus rien à faire défiler.
    expect(rule).toContain('min-height: 1.75rem');
    expect(rule).toContain('flex-shrink: 0');
  });
});

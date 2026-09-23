// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import ToolRail from './ToolRail';
import { toolsFor, viewActionsFor, type RailSection } from './tools';
import { splatEditRail } from '../splat/splatChrome';
import { t } from '../../../i18n';

/**
 * Le rail à plusieurs groupes (Phase 50, lot 13). Ce qui est vérifié : un outil d'un second
 * groupe est **directement cliquable** — c'est la demande — et il arme le couple mode + outil de
 * son groupe, donc exactement ce que sa lettre arme au clavier.
 */
const MAIN: RailSection = { mode: 'explore', titleKey: 'rail.tools', tools: toolsFor('explore', 'SPLAT') };
const EDIT = splatEditRail(true)!;

function mount(opts: { sections?: RailSection[]; mode?: RailSection['mode']; tool?: string } = {}) {
  const onTool = vi.fn();
  render(
    <ToolRail
      sections={opts.sections ?? [MAIN, EDIT]}
      actions={viewActionsFor('SPLAT')}
      mode={opts.mode ?? 'explore'}
      tool={(opts.tool ?? 'nav') as never}
      onTool={onTool}
      onAction={vi.fn()}
      labels
      onLabels={vi.fn()}
    />,
  );
  return { onTool };
}

describe('ToolRail — groupes', () => {
  it('montre les outils d’édition sans qu’aucun mode soit armé', () => {
    mount();
    for (const tool of EDIT.tools)
      expect(screen.getByRole('button', { name: t(tool.labelKey) })).toBeInTheDocument();
  });

  it('arme le couple mode + outil du groupe cliqué', () => {
    const { onTool } = mount();
    fireEvent.click(screen.getByRole('button', { name: t('tool.selLasso') }));
    expect(onTool).toHaveBeenCalledWith('sel-lasso', 'clean');
    fireEvent.click(screen.getByRole('button', { name: t('tool.poi') }));
    expect(onTool).toHaveBeenCalledWith('pin', 'explore');
  });

  it('n’allume un outil que dans le groupe qui l’arme', () => {
    // `translate` n'existe que dans « Nettoyer » : armé, c'est le bouton du second groupe qui
    // s'allume, et le premier groupe reste au repos — c'est par lui qu'on ressort du mode.
    mount({ mode: 'clean', tool: 'translate' });
    expect(screen.getByRole('button', { name: t('tool.translate') })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: t('tool.nav') })).toHaveAttribute('aria-pressed', 'false');
  });

  it('titre chaque groupe et garde les deux actions de vue en pied', () => {
    mount();
    expect(screen.getByText(t('rail.tools'))).toBeInTheDocument();
    expect(screen.getByText(t(EDIT.titleKey))).toBeInTheDocument();
    for (const action of viewActionsFor('SPLAT'))
      expect(screen.getByRole('button', { name: t(action.labelKey) })).toBeInTheDocument();
  });

  it('se réduit à un seul groupe quand le viewer n’en fournit qu’un', () => {
    mount({ sections: [MAIN] });
    expect(screen.queryByRole('button', { name: t('tool.selRect') })).not.toBeInTheDocument();
  });
});

/**
 * Lot 15 — contrat de hauteur du rail, le même piège que `.rv-row` : un `min-height` EXPLICITE
 * remplace la taille minimale automatique du flex, donc rouvre la compression que celle-ci
 * interdisait. Le rail est une colonne bornée par la hauteur du viewer, et depuis que le splat y
 * pose un second groupe il porte une quinzaine d'entrées : sans refus de compression, les boutons
 * s'écrasent sous leur hauteur et leur contenu déborde — et sans ascenseur, rien ne rattrape.
 *
 * Les classes du rail vivent dans une feuille que vitest ne charge pas, et happy-dom ne met rien
 * en page : la feuille est donc lue comme un texte. C'est une preuve de structure, pas de rendu.
 */
const CHROME_CSS = readFileSync(resolve(process.cwd(), 'src/v2/pages/review/chrome/chrome.css'), 'utf8');
const COMMENT = /\/\*[\s\S]*?\*\//g;

/** Corps d'une règle, sélecteur exact : `.rv-rail` ne ramène ni `.rv-rail--labels` ni `.rv-rail__title`. */
function ruleOf(selector: string): string {
  const start = CHROME_CSS.indexOf(`\n${selector} {`);
  expect(start, `règle ${selector} introuvable dans chrome.css`).toBeGreaterThan(-1);
  const open = CHROME_CSS.indexOf('{', start);
  // Les COMMENTAIRES sont retirés : celui de `.rv-railbtn` cite la déclaration qu'on cherche, et
  // l'assertion passerait alors même que la déclaration aurait disparu.
  return CHROME_CSS.slice(open, CHROME_CSS.indexOf('}', open)).replace(COMMENT, '');
}

describe('rail — contrat de hauteur', () => {
  it('refuse de comprimer ses boutons sous leur hauteur', () => {
    const rule = ruleOf('.rv-railbtn');
    // Le couple compte : c'est le `min-height` explicite qui défait la protection automatique.
    expect(rule).toContain('min-height: 2.25rem');
    expect(rule).toContain('flex-shrink: 0');
  });

  it('défile quand il porte plus d’entrées que la hauteur du viewer', () => {
    expect(ruleOf('.rv-rail')).toContain('overflow-y: auto');
    expect(ruleOf('.rv-dock__tabs')).toContain('overflow-y: auto');
  });
});

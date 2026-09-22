// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

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

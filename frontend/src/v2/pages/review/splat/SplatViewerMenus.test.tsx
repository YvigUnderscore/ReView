// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import SplatViewerMenus from './SplatViewerMenus';
import { splatEditTools } from './splatChrome';
import { defaultChromeState, type ChromeState } from '../chrome/chromeState';
import { panelsFor } from '../chrome/panels';
import type { SplatCompareState } from './compare/useSplatCompare';
import type { SplatEditorState } from './editor/useSplatEditor';
import { t } from '../../../i18n';

/**
 * Les outils d'ÉDITION et les réglages de RENDU du splat vivent sur le viewer (Phase 50, lot
 * 12), dans le même langage que le popover de rendu du modèle 3D (lot 6).
 *
 * Ce qui est vérifié ici est exactement ce que le retrait des deux segments d'en-tête doit
 * préserver : chaque outil de « Nettoyer » reste atteignable à la souris, il arme le même
 * couple mode + outil que sa lettre, l'édition se quitte sans bascule, et les réglages de rendu
 * passent par l'état de l'éditeur — celui-là même qui les applique à la scène.
 */

const editorState = (over: Partial<SplatEditorState> = {}) =>
  ({
    renderMode: 'splats',
    setRenderMode: vi.fn(),
    baseFlip: true,
    toggleBaseFlip: vi.fn(),
    ...over,
  }) as unknown as SplatEditorState;

const presState = () => ({ debugMode: 'none' as const, setDebugMode: vi.fn() });

function mount(
  opts: {
    state?: Partial<ChromeState>;
    showEdit?: boolean;
    editor?: SplatEditorState;
    compare?: SplatCompareState;
  } = {},
) {
  const onState = vi.fn();
  const editor = opts.editor ?? editorState();
  render(
    <SplatViewerMenus
      state={{ ...defaultChromeState(), ...opts.state }}
      onState={onState}
      editor={editor}
      showEdit={opts.showEdit ?? true}
      pres={presState()}
      compare={opts.compare}
    />,
  );
  return { onState, editor };
}

const openEdit = () => fireEvent.click(screen.getByRole('button', { name: t('viewer.edit.title') }));
const openRender = () => fireEvent.click(screen.getByRole('button', { name: t('viewer.render.title') }));

describe('dock du splat', () => {
  it('n’a plus d’onglet « Affichage » — les réglages de rendu sont sur le viewer', () => {
    // Le libellé de l'onglet a été retiré des catalogues avec lui : c'est la composition du
    // dock qui l'atteste, seule source de vérité des onglets.
    expect(panelsFor('SPLAT').map((p) => p.id)).toEqual(['camera', 'scene', 'info', 'export']);
  });
});

describe('SplatViewerMenus — menu d’édition', () => {
  it('n’existe que quand l’éditeur est monté', () => {
    mount({ showEdit: false });
    expect(screen.queryByRole('button', { name: t('viewer.edit.title') })).not.toBeInTheDocument();
    // Le rendu, lui, reste offert : il ne règle rien qui s'enregistre.
    expect(screen.getByRole('button', { name: t('viewer.render.title') })).toBeInTheDocument();
  });

  it('porte tous les outils d’édition, avec leur raccourci', () => {
    mount();
    openEdit();
    for (const tool of splatEditTools()) {
      const button = screen.getByRole('button', { name: t(tool.labelKey) });
      expect(button).toBeInTheDocument();
      // Le raccourci est annoncé à côté du libellé, comme au rail : c'est ce qui apprend la
      // lettre à qui clique, et la lettre reste le chemin le plus court.
      expect(button.querySelector('.rv-railbtn__key')).toHaveTextContent(tool.key);
    }
  });

  it('arme le même couple mode + outil que la lettre du clavier', () => {
    const { onState } = mount();
    openEdit();
    fireEvent.click(screen.getByRole('button', { name: t('tool.selLasso') }));
    expect(onState).toHaveBeenCalledWith({ mode: 'clean', tool: 'sel-lasso' });
  });

  it('montre l’outil armé comme actif, et lui seul', () => {
    mount({ state: { mode: 'clean', tool: 'volume' } });
    openEdit();
    expect(screen.getByRole('button', { name: t('tool.volume') })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: t('tool.selRect') })).toHaveAttribute('aria-pressed', 'false');
  });

  it('arme et quitte l’édition par son interrupteur — la seule sortie à la souris', () => {
    const { onState } = mount();
    openEdit();
    fireEvent.click(screen.getByRole('switch', { name: t('viewer.edit.hint') }));
    expect(onState).toHaveBeenCalledWith({ mode: 'clean' });
  });

  it('revient à l’exploration quand l’interrupteur retombe', () => {
    const { onState } = mount({ state: { mode: 'clean', tool: 'sel-brush' } });
    openEdit();
    fireEvent.click(screen.getByRole('switch', { name: t('viewer.edit.hint') }));
    expect(onState).toHaveBeenCalledWith({ mode: 'explore' });
  });
});

describe('SplatViewerMenus — menu de rendu', () => {
  it('porte les trois modes de rendu du nuage et passe par l’état de l’éditeur', () => {
    const setRenderMode = vi.fn();
    mount({ editor: editorState({ setRenderMode }) });
    openRender();

    const group = screen.getByRole('group', { name: t('viewer.render.cloud') });
    expect(group.querySelectorAll('button')).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: t('viewer.mode.points') }));
    expect(setRenderMode).toHaveBeenCalledWith('points');
  });

  it('garde l’orientation du fichier, qui est une édition', () => {
    const toggleBaseFlip = vi.fn();
    mount({ editor: editorState({ toggleBaseFlip }) });
    openRender();
    fireEvent.click(screen.getByRole('switch', { name: t('viewer.upAxis.hint') }));
    expect(toggleBaseFlip).toHaveBeenCalled();
  });

  it('ne propose ni rendu du nuage ni orientation sans éditeur', () => {
    mount({ showEdit: false });
    openRender();
    expect(screen.queryByRole('group', { name: t('viewer.render.cloud') })).not.toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: t('viewer.upAxis.hint') })).not.toBeInTheDocument();
    // La teinte d'inspection, elle, ne s'enregistre pas : elle reste offerte à tout le monde.
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('offre l’échelle brute dès que la comparaison porte deux nuages', () => {
    const toggleNormalized = vi.fn();
    mount({
      compare: { enabled: true, normalized: true, toggleNormalized } as unknown as SplatCompareState,
    });
    openRender();
    fireEvent.click(screen.getByRole('switch', { name: t('viewer.realScale.hint') }));
    expect(toggleNormalized).toHaveBeenCalled();
  });
});

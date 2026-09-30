// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import SplatViewerMenus from './SplatViewerMenus';
import { splatEditTools } from './splatChrome';
import { panelsFor } from '../chrome/panels';
import type { SplatCompareState } from './compare/useSplatCompare';
import type { SplatEditorState } from './editor/useSplatEditor';
import { t } from '../../../i18n';

/**
 * Les réglages de RENDU du splat vivent sur le viewer (Phase 50, lot 12), dans le même langage
 * que le popover de rendu du modèle 3D (lot 6) : l'onglet « Affichage » du dock a disparu avec
 * eux, et c'est l'état de l'éditeur — celui-là même qui les applique à la scène — qui les porte.
 *
 * Les cas du popover « Édition » ont été RETIRÉS en connaissance de cause au lot 13 : ce popover
 * n'existe plus. Il portait les outils du mode « Nettoyer », or l'utilisateur avait demandé de
 * retirer le SEGMENT de l'en-tête, pas de ranger les outils derrière un clic. Ils sont revenus au
 * rail (`splatChrome.splatEditRail`, vérifié par `splatChrome.test.ts` et `ToolRail.test.tsx`), et
 * le dernier cas ci-dessous verrouille l'absence du doublon.
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

function mount(opts: { showEdit?: boolean; editor?: SplatEditorState; compare?: SplatCompareState } = {}) {
  const editor = opts.editor ?? editorState();
  render(
    <SplatViewerMenus
      editor={editor}
      showEdit={opts.showEdit ?? true}
      pres={presState()}
      compare={opts.compare}
    />,
  );
  return { editor };
}

const openRender = () => fireEvent.click(screen.getByRole('button', { name: t('viewer.render.title') }));

describe('dock du splat', () => {
  it('n’a plus d’onglet « Affichage » — les réglages de rendu sont sur le viewer', () => {
    // Le libellé de l'onglet a été retiré des catalogues avec lui : c'est la composition du
    // dock qui l'atteste, seule source de vérité des onglets.
    expect(panelsFor('SPLAT').map((p) => p.id)).toEqual(['camera', 'scene', 'info', 'export']);
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

describe('le viewer ne double plus le rail', () => {
  it('n’a plus de menu « Édition » : ses outils sont au rail, à un clic', () => {
    mount();
    expect(screen.queryByRole('button', { name: t('viewer.edit.title') })).not.toBeInTheDocument();
    // Et aucun de ses outils n'est atteignable ici : un seul emplacement les porte.
    for (const tool of splatEditTools())
      expect(screen.queryByRole('button', { name: t(tool.labelKey) })).not.toBeInTheDocument();
  });
});

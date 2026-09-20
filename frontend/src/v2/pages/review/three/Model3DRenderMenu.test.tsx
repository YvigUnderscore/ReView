// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import Model3DRenderMenu from './Model3DRenderMenu';
import { panelsFor } from '../chrome/panels';
import { DISPLAY_MODES } from './displayModes';
import type { Model3DInspectState } from './useModel3DInspect';
import type { Model3DVariantsState } from './useModel3DVariants';
import { t } from '../../../i18n';

/**
 * L'onglet « Affichage » du dock 3D a disparu : ses réglages vivent en popover au coin
 * haut-gauche du viewer. Ce qui est vérifié ici est exactement ce que le retrait de l'onglet
 * doit préserver — la liste complète des réglages qui ont un effet, et le fait que le mode de
 * rendu remonte au même état (`useModel3DInspect`) que celui qui applique l'override à la
 * scène, sans qu'un second chemin s'ouvre.
 */

const inspectState = (over: Partial<Model3DInspectState> = {}): Model3DInspectState => ({
  mode: 'shaded',
  setMode: vi.fn(),
  stats: null,
  extensions: [],
  hasSkeleton: false,
  showSkeleton: false,
  setShowSkeleton: vi.fn(),
  ...over,
});

const variantsState = (over: Partial<Model3DVariantsState> = {}): Model3DVariantsState => ({
  variants: [],
  cameras: [],
  current: -1,
  selectVariant: vi.fn(),
  goToCamera: vi.fn(),
  ...over,
});

/** Ouvre le popover et rend son contenu atteignable. */
function open(inspect: Model3DInspectState, variants = variantsState()) {
  render(<Model3DRenderMenu inspect={inspect} variants={variants} />);
  fireEvent.click(screen.getByRole('button', { name: t('viewer.render.title') }));
}

describe('dock 3D', () => {
  it('n’a plus d’onglet « Affichage » — le splat garde le sien', () => {
    expect(panelsFor('MODEL_3D').map((p) => p.id)).not.toContain('display');
    expect(panelsFor('SPLAT').map((p) => p.id)).toContain('display');
  });
});

describe('Model3DRenderMenu', () => {
  it('porte les cinq modes de rendu, et rien de moins', () => {
    open(inspectState());
    const group = screen.getByRole('group', { name: t('viewer.render.model') });
    expect(group.querySelectorAll('button')).toHaveLength(DISPLAY_MODES.length);
    for (const mode of ['shaded', 'wireframe', 'normals', 'matcap', 'uv'] as const)
      expect(screen.getByRole('button', { name: t(`viewer.mode.${mode}`) })).toBeInTheDocument();
  });

  it('change le mode de rendu par le chemin du composant de review', () => {
    const setMode = vi.fn();
    open(inspectState({ setMode }));
    fireEvent.click(screen.getByRole('button', { name: t('viewer.mode.wireframe') }));
    expect(setMode).toHaveBeenCalledWith('wireframe');
  });

  it('montre le mode courant comme actif', () => {
    open(inspectState({ mode: 'matcap' }));
    expect(screen.getByRole('button', { name: t('viewer.mode.matcap') })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('offre variantes de matériaux et caméras embarquées quand le fichier en porte', () => {
    const selectVariant = vi.fn();
    open(
      inspectState(),
      variantsState({
        variants: ['Wood', 'Metal'],
        current: 0,
        selectVariant,
        cameras: [{ name: 'shotCam' }] as Model3DVariantsState['cameras'],
      }),
    );
    // Deux listes : variantes de matériaux d'abord, caméras embarquées ensuite — l'ordre du
    // panneau, celui-là même que servait l'onglet retiré.
    // Deux listes : variantes de matériaux d'abord, caméras embarquées ensuite — l'ordre du
    // panneau, celui-là même que servait l'onglet retiré.
    const selects = screen.getAllByRole('combobox');
    expect(selects).toHaveLength(2);
    expect(screen.getByText('Wood')).toBeInTheDocument();
    expect(screen.getByText('shotCam')).toBeInTheDocument();
    fireEvent.change(selects[0], { target: { value: 'Metal' } });
    expect(selectVariant).toHaveBeenCalledWith(1);
  });

  it('offre le squelette du rig seulement quand le modèle en a un', () => {
    const setShowSkeleton = vi.fn();
    open(inspectState({ hasSkeleton: true, setShowSkeleton }));
    fireEvent.click(screen.getByRole('switch', { name: t('viewer.skeleton.hint') }));
    expect(setShowSkeleton).toHaveBeenCalledWith(true);
  });

  it('ne montre ni variante ni squelette sur un fichier qui n’en a pas', () => {
    open(inspectState());
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });
});

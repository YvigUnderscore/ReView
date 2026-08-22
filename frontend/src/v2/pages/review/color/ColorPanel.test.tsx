// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../../../test/renderWithProviders';
import { t } from '../../../i18n';
import ColorPanel from './ColorPanel';
import { useColorGrade } from './useColorGrade';

const CONFIG = 'cfg-1';
const projectColor = { configId: CONFIG, display: 'sRGB - Display', view: 'ACES 1.0 - SDR Video' };

const displaysRoute = {
  [`GET /api/studio/ocio/configs/${CONFIG}/displays`]: {
    displays: [
      { name: 'sRGB - Display', views: ['ACES 1.0 - SDR Video', 'Raw'] },
      { name: 'Rec.1886 Rec.709 - Display', views: ['ACES 1.0 - SDR Video'] },
    ],
  },
};

/** Le serveur n'a pas d'outillage OCIO : la vue tone-mappée n'a pas de LUT. */
const lutMissing = {
  [`GET /api/studio/ocio/configs/${CONFIG}/lut`]: {
    lut: { url: null, size: 33, reason: 'OCIO_TOOLING_REQUIRED' },
  },
};

describe('ColorPanel', () => {
  beforeEach(() => {
    localStorage.clear();
    useColorGrade.getState().reset();
  });

  it('sans configuration couleur de projet, il le dit et n’offre aucun choix', async () => {
    renderWithProviders(<ColorPanel projectColor={null} applies />);
    expect(await screen.findByText(t('color.noConfig'))).toBeInTheDocument();
    expect(screen.getByLabelText(t('ocio.display'))).toBeDisabled();
    expect(screen.getByLabelText(t('ocio.view'))).toBeDisabled();
  });

  it('rappelle toujours que le média n’est pas modifié', () => {
    renderWithProviders(<ColorPanel projectColor={null} applies />);
    expect(screen.getByText(t('color.readingOnly'))).toBeInTheDocument();
  });

  it('propose les display/view de la config et retient le choix du lecteur', async () => {
    const { user } = renderWithProviders(<ColorPanel projectColor={projectColor} applies />, {
      api: { ...displaysRoute, ...lutMissing },
    });
    await screen.findByRole('option', { name: 'Rec.1886 Rec.709 - Display' });
    expect(screen.getByLabelText(t('ocio.display'))).toHaveValue('sRGB - Display');
    expect(screen.getByLabelText(t('ocio.view'))).toHaveValue('ACES 1.0 - SDR Video');

    await user.selectOptions(screen.getByLabelText(t('ocio.view')), 'Raw');
    expect(useColorGrade.getState().settings.view).toBe('Raw');
    expect(useColorGrade.getState().settings.display).toBe('sRGB - Display');
  });

  it('dit qu’aucune LUT n’est cuite plutôt que d’afficher une transformée fausse', async () => {
    renderWithProviders(<ColorPanel projectColor={projectColor} applies />, {
      api: { ...displaysRoute, ...lutMissing },
    });
    expect(await screen.findByText(t('color.unavailable'))).toBeInTheDocument();
  });

  it('la bascule coupe la transformée et le panneau l’annonce', async () => {
    const { user } = renderWithProviders(<ColorPanel projectColor={projectColor} applies />, {
      api: { ...displaysRoute, ...lutMissing },
    });
    await user.click(await screen.findByRole('switch', { name: t('color.transform') }));
    expect(useColorGrade.getState().settings.enabled).toBe(false);
    expect(await screen.findByText(t('color.transformOff'))).toBeInTheDocument();
  });

  it('l’exposition se saisit au clavier et le retour à zéro la remet à plat', async () => {
    const { user, container } = renderWithProviders(<ColorPanel projectColor={null} applies />);
    const reset = screen.getByRole('button', { name: t('common.reset') });
    expect(reset).toBeDisabled();

    // Les deux champs numériques du panneau, dans l'ordre : exposition puis gamma.
    const exposure = container.querySelectorAll('input[inputmode="decimal"]')[0];
    await user.clear(exposure);
    await user.type(exposure, '1.5{Enter}');
    expect(useColorGrade.getState().settings.exposure).toBe(1.5);

    await user.click(screen.getByRole('button', { name: t('common.reset') }));
    expect(useColorGrade.getState().settings.exposure).toBe(0);
  });

  it('sans WebGL, le panneau dit que les pixels restent tels quels', async () => {
    useColorGrade.getState().markUnsupported();
    renderWithProviders(<ColorPanel projectColor={projectColor} applies />, {
      api: { ...displaysRoute, ...lutMissing },
    });
    expect(await screen.findByText(t('color.unsupported'))).toBeInTheDocument();
  });

  it('sur un média non image, le panneau annonce que rien n’est appliqué', async () => {
    renderWithProviders(<ColorPanel projectColor={projectColor} applies={false} />, {
      api: { ...displaysRoute, ...lutMissing },
    });
    expect(await screen.findByText(t('color.imageOnly'))).toBeInTheDocument();
  });
});

// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const { api } = vi.hoisted(() => ({ api: { post: vi.fn() } }));
vi.mock('../../../../lib/apiClient', () => ({ api, setSessionExpiredHandler: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import UsdRecomposeGroup from './UsdRecomposeGroup';
import type { UsdModelInfo } from '../../../types/api';
import { t } from '../../../i18n';

/**
 * La recomposition USD n'est plus une modale (lot 13).
 *
 * Le défaut signalé : le `Dialog` était centré sans hauteur maximale ni défilement, et une
 * scène de production expose des dizaines de jeux de variantes — la fiche dépassait des deux
 * côtés de la fenêtre, le bouton d'envoi compris, et l'overlay interdisait de tourner autour
 * de la scène pendant qu'on choisissait. Ce qui est vérifié ici : plus aucun dialogue, la
 * liste défile, et l'envoi porte bien la sélection composée à l'écran.
 */

const MEDIA = 42;

/** Fiche USD minimale : seuls les jeux de variantes et le purpose comptent pour ce groupe. */
const usdWith = (variantSets: UsdModelInfo['variantSets']): UsdModelInfo => ({
  rootLayer: 'scene.usda',
  defaultPrim: '/World',
  upAxis: 'Y',
  metersPerUnit: 1,
  frameRange: null,
  fps: null,
  hasAnimation: false,
  hasSkeleton: false,
  variantSets,
  purposes: [],
  selection: { variants: {}, purpose: 'render' },
  selectionApplied: true,
  missingAssets: [],
  missingAssetsTotal: 0,
  layerCount: 1,
  primCount: 0,
  prims: [],
  primsTruncated: false,
});

/** Une scène riche : trente jeux de variantes, c'est là que l'ancienne modale débordait. */
const MANY = usdWith(
  Array.from({ length: 30 }, (_, i) => ({
    prim: `/World/Asset${i}`,
    name: `lookVariant${i}`,
    options: ['clean', 'dirty'],
    selected: 'clean',
  })),
);

const ONE = usdWith([
  { prim: '/World/Chair', name: 'lookVariant', options: ['clean', 'dirty'], selected: 'clean' },
]);

const mount = (usd: UsdModelInfo) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <UsdRecomposeGroup mediaId={MEDIA} usd={usd} />
    </QueryClientProvider>,
  );

const submit = () => screen.getByRole('button', { name: t('usd.recomposeFrom') });

beforeEach(() => {
  vi.clearAllMocks();
  api.post.mockResolvedValue({});
});

afterEach(cleanup);

describe('UsdRecomposeGroup', () => {
  it('n’est plus une modale : rien ne recouvre le viewer', () => {
    mount(MANY);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('défile quand la scène expose plus de variantes que la hauteur du dock', () => {
    mount(MANY);
    const list = screen.getByTestId('usd-variant-scroll');
    // Tous les jeux sont là — aucun n'est tronqué — et c'est la liste qui porte l'ascenseur.
    expect(list.querySelectorAll('select')).toHaveLength(MANY.variantSets.length);
    expect(list.className).toContain('overflow-y-auto');
    expect(list.className).toMatch(/max-h-/);
  });

  it('garde le bouton d’envoi hors de la liste défilante — il reste atteignable', () => {
    mount(MANY);
    expect(screen.getByTestId('usd-variant-scroll').contains(submit())).toBe(false);
  });

  it('envoie le purpose et la variante choisis à l’écran', () => {
    mount(ONE);
    const [purpose, variant] = screen.getAllByRole('combobox');
    fireEvent.change(purpose, { target: { value: 'proxy' } });
    fireEvent.change(variant, { target: { value: 'dirty' } });
    fireEvent.click(submit());
    expect(api.post).toHaveBeenCalledWith(`/api/media/${MEDIA}/usd/recompose`, {
      purpose: 'proxy',
      variants: { '/World/Chair': { lookVariant: 'dirty' } },
    });
  });

  it('envoie la sélection en place quand rien n’est touché', () => {
    mount(ONE);
    fireEvent.click(submit());
    expect(api.post).toHaveBeenCalledWith(`/api/media/${MEDIA}/usd/recompose`, {
      purpose: 'render',
      variants: { '/World/Chair': { lookVariant: 'clean' } },
    });
  });

  it('le dit quand la scène n’expose aucune variante, et garde le purpose', () => {
    mount(usdWith([]));
    expect(screen.getByText(t('review.usd.noVariants'))).toBeInTheDocument();
    expect(screen.queryByTestId('usd-variant-scroll')).not.toBeInTheDocument();
    expect(submit()).toBeEnabled();
  });
});

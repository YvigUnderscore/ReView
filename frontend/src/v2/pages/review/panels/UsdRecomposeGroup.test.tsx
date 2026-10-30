// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const { api } = vi.hoisted(() => ({ api: { post: vi.fn() } }));
vi.mock('@/lib/apiClient', () => ({ api, setSessionExpiredHandler: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import UsdRecomposeGroup from './UsdRecomposeGroup';
import type { UsdModelInfo } from '@/v2/types/api';
import { t } from '@/v2/i18n';

/**
 * USD recomposition is no longer a modal (batch 13).
 *
 * The reported defect: the `Dialog` was centred with no maximum height and no scrolling, and a
 * production scene exposes dozens of variant sets. The sheet overflowed on both sides of the window,
 * the submit button included, and the overlay prevented orbiting the scene while choosing. What is
 * checked here: no dialog remains, the list scrolls, and the submission carries the selection as
 * composed on screen.
 */

const MEDIA = 42;

/** Minimal USD sheet: only the variant sets and the purpose matter to this group. */
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

/** A rich scene: thirty variant sets, which is where the former modal overflowed. */
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
  it('is no longer a modal: nothing covers the viewer', () => {
    mount(MANY);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('scrolls when the scene exposes more variants than the dock height', () => {
    mount(MANY);
    const list = screen.getByTestId('usd-variant-scroll');
    // All the sets are there, none is truncated, and it is the list that carries the scrollbar.
    expect(list.querySelectorAll('select')).toHaveLength(MANY.variantSets.length);
    expect(list.className).toContain('overflow-y-auto');
    expect(list.className).toMatch(/max-h-/);
  });

  it('places each set in a dock row, within a bounded scrolling column', () => {
    mount(MANY);
    const list = screen.getByTestId('usd-variant-scroll');
    // This test does NOT prove the batch 15 fix: it also passes with the defect in place, and its
    // title once said so wrongly. The refusal to compress is a property of `.rv-row`, and it is
    // verified in `DockGroup.test.tsx`. What is verified HERE is the other half of the contract: that
    // the column is indeed bounded and scrolling, and that its children are precisely the rows this
    // rule covers.
    expect(list.className).toMatch(/max-h-/);
    expect(list.className).toContain('overflow-y-auto');
    const rows = Array.from(list.children);
    expect(rows).toHaveLength(MANY.variantSets.length);
    for (const row of rows) {
      expect(row.className.split(' ')).toContain('rv-row');
      expect(row.className.split(' ')).toContain('rv-row--stack');
    }
  });

  it('cuts the name of a variant set rather than letting it overflow the dock', () => {
    mount(ONE);
    // A USD identifier has no reason to fit in 280 px; the prim path, for its part, remains in the
    // row's tooltip.
    expect(screen.getByText('lookVariant').className.split(' ')).toContain('truncate');
    expect(screen.getByText('lookVariant').closest('.rv-row')).toHaveAttribute('title', '/World/Chair');
  });

  it('keeps the submit button out of the scrolling list: it stays reachable', () => {
    mount(MANY);
    expect(screen.getByTestId('usd-variant-scroll').contains(submit())).toBe(false);
  });

  it('sends the purpose and variant chosen on screen', () => {
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

  it('sends the selection in place when nothing is touched', () => {
    mount(ONE);
    fireEvent.click(submit());
    expect(api.post).toHaveBeenCalledWith(`/api/media/${MEDIA}/usd/recompose`, {
      purpose: 'render',
      variants: { '/World/Chair': { lookVariant: 'clean' } },
    });
  });

  it('says so when the scene exposes no variant, and keeps the purpose', () => {
    mount(usdWith([]));
    expect(screen.getByText(t('review.usd.noVariants'))).toBeInTheDocument();
    expect(screen.queryByTestId('usd-variant-scroll')).not.toBeInTheDocument();
    expect(submit()).toBeEnabled();
  });
});

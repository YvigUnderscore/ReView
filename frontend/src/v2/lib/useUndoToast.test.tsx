// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithProviders';
import { t } from '../i18n';
import { useUndoToast } from './useUndoToast';

/** A minimal screen: it announces a success, with or without an inverse. */
function Screen({ undo }: { undo?: () => Promise<unknown> }) {
  const { done } = useUndoToast();
  return (
    <button type="button" onClick={() => done('Status set', undo)}>
      go
    </button>
  );
}

describe('useUndoToast', () => {
  it('replays the inverse on clicking "Undo", then confirms it', async () => {
    const undo = vi.fn<() => Promise<unknown>>(() => Promise.resolve());
    const { user } = renderWithProviders(<Screen undo={undo} />);
    await user.click(screen.getByRole('button', { name: 'go' }));
    await user.click(await screen.findByRole('button', { name: t('common.undo') }));
    expect(undo).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(t('common.undone'))).toBeTruthy();
  });

  it('reports that the undo failed — it is a write like any other', async () => {
    const undo = vi.fn<() => Promise<unknown>>(() => Promise.reject(new Error('403 refusé')));
    const { user } = renderWithProviders(<Screen undo={undo} />);
    await user.click(screen.getByRole('button', { name: 'go' }));
    await user.click(await screen.findByRole('button', { name: t('common.undo') }));
    expect(await screen.findByText('403 refusé')).toBeTruthy();
    expect(screen.queryByText(t('common.undone'))).toBeNull();
  });

  it('with no tracked inverse, no undo promise is shown', async () => {
    const { user } = renderWithProviders(<Screen />);
    await user.click(screen.getByRole('button', { name: 'go' }));
    expect(await screen.findByText('Status set')).toBeTruthy();
    expect(screen.queryByRole('button', { name: t('common.undo') })).toBeNull();
  });
});

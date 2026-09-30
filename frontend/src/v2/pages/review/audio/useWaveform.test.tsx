// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '../../../../test/renderWithProviders';
import { useWaveform } from './useWaveform';

const encode = (bytes: number[]): string => btoa(String.fromCharCode(...bytes));

function Probe({ mediaId }: { mediaId: number }) {
  const w = useWaveform(mediaId);
  return (
    <div>
      <span data-testid="state">{`${w.available}/${w.visible}/${w.peaks?.length ?? 'none'}`}</span>
      <button onClick={w.toggle}>toggle</button>
    </div>
  );
}

const withMedia = (waveform: unknown) =>
  renderWithProviders(<Probe mediaId={7} />, { api: { 'GET /api/media/7': { waveform } } });

describe('useWaveform', () => {
  it('déplie la forme d’onde portée par le média', async () => {
    withMedia({ version: 1, bins: 3, peaks: encode([0, 128, 255]) });
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('true/true/3'));
  });

  it('média muet : rien à afficher, et rien à proposer au clic droit', async () => {
    withMedia(null);
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('false/true/none'));
  });

  it('masquer retient le choix et coupe le tracé sans oublier la piste', async () => {
    const { user } = withMedia({ version: 1, bins: 3, peaks: encode([0, 128, 255]) });
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('true/true/3'));
    await user.click(screen.getByRole('button'));
    expect(screen.getByTestId('state')).toHaveTextContent('true/false/none');
    expect(localStorage.getItem('review:video:waveform')).toBe('0');
  });
});

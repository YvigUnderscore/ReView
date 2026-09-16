// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import SelectionBar from './selection-bar';

/**
 * Le retrait de la barre, quand framer-motion n'est plus là pour le tenir.
 *
 * `AnimatePresence` gardait le nœud monté le temps de la sortie **et** gelait ce qu'il
 * affichait. C'est ce second point qui se perd sans y penser : à la dernière image, la page
 * a déjà vidé la sélection, et une barre naïve annoncerait « 0 sélectionnés » pendant qu'elle
 * redescend. Ces cas-là verrouillent les deux : elle reste 180 ms, et elle continue
 * d'annoncer le dernier compte réel.
 */

const ACTIONS = [{ label: 'Supprimer', onClick: () => {} }];

afterEach(() => {
  vi.useRealTimers();
});

describe('SelectionBar', () => {
  it('n’existe pas tant que rien n’est sélectionné', () => {
    render(<SelectionBar count={0} actions={ACTIONS} onClear={() => {}} label="plans" />);
    expect(screen.queryByText('plans')).not.toBeInTheDocument();
  });

  it('apparaît par le bas dès la première sélection', () => {
    render(<SelectionBar count={3} actions={ACTIONS} onClear={() => {}} label="plans" />);
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('plans').closest('div.fixed')).toHaveClass('animate-in');
  });

  it('reste montée le temps de redescendre, en gardant le dernier compte affiché', () => {
    vi.useFakeTimers();
    const { rerender } = render(
      <SelectionBar count={3} actions={ACTIONS} onClear={() => {}} label="plans" />,
    );

    // Ce que fait la page quand on vide la sélection : le compte tombe à zéro d'un coup.
    act(() => {
      rerender(<SelectionBar count={0} actions={ACTIONS} onClear={() => {}} label="plans" />);
    });
    const bar = screen.getByText('plans').closest('div.fixed');
    expect(bar).toHaveClass('animate-out');
    // Le gel : « 3 », pas « 0 ».
    expect(screen.getByText('3')).toBeInTheDocument();

    // Juste avant la fin de l'animation, elle est encore là.
    act(() => {
      vi.advanceTimersByTime(179);
    });
    expect(screen.getByText('plans')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByText('plans')).not.toBeInTheDocument();
  });

  it('reprend l’apparition si une sélection repart avant la fin du retrait', () => {
    vi.useFakeTimers();
    const { rerender } = render(
      <SelectionBar count={2} actions={ACTIONS} onClear={() => {}} label="plans" />,
    );
    act(() => {
      rerender(<SelectionBar count={0} actions={ACTIONS} onClear={() => {}} label="plans" />);
    });
    act(() => {
      vi.advanceTimersByTime(50);
      rerender(<SelectionBar count={5} actions={ACTIONS} onClear={() => {}} label="plans" />);
    });

    // Le compte à rebours du retrait a été annulé : passé son terme, la barre est toujours là.
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('plans').closest('div.fixed')).toHaveClass('animate-in');
  });
});

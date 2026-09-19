// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCompareArm } from './useCompareArm';

/**
 * Le lien entre le segment « Compare » de la bascule et l'état de comparaison.
 *
 * Les deux vivaient côte à côte sans se parler : cliquer « Compare » n'ouvrait aucune
 * comparaison et la barre de wipe ne s'affichait jamais. Ce qui est vérifié ici : les trois
 * règles et leurs réciproques.
 */
type Props = Parameters<typeof useCompareArm>[0];

const spies = () => ({
  onMode: vi.fn(),
  onSetB: vi.fn(),
  onClear: vi.fn(),
  onCompareMode: vi.fn(),
});

const arm = (props: Partial<Props> & ReturnType<typeof spies>) => {
  const initial: Props = { mode: 'explore', hasB: false, firstB: null, ...props };
  const hook = renderHook((p: Props) => useCompareArm(p), { initialProps: initial });
  return { ...hook, initial };
};

describe('useCompareArm', () => {
  it('armer Compare met le mode de comparaison sur le wipe', () => {
    const s = spies();
    const { rerender, initial } = arm(s);
    expect(s.onCompareMode).not.toHaveBeenCalled();
    rerender({ ...initial, mode: 'compare' });
    expect(s.onCompareMode).toHaveBeenCalledWith('wipe');
  });

  it('armer Compare sans B prend le premier média comparable, une seule fois', () => {
    const s = spies();
    const { rerender, initial } = arm(s);
    // Les détails des versions voisines arrivent après : le choix attend `firstB`.
    rerender({ ...initial, mode: 'compare' });
    expect(s.onSetB).not.toHaveBeenCalled();
    rerender({ ...initial, mode: 'compare', firstB: 42 });
    expect(s.onSetB).toHaveBeenCalledWith(42);
    rerender({ ...initial, mode: 'compare', firstB: 42 });
    expect(s.onSetB).toHaveBeenCalledTimes(1);
  });

  it('sortir du mode ferme la comparaison ouverte', () => {
    const s = spies();
    const { rerender, initial } = arm({ ...s, mode: 'compare', hasB: true });
    rerender({ ...initial, mode: 'explore', hasB: true });
    expect(s.onClear).toHaveBeenCalledTimes(1);
  });

  it('sortir du mode sans comparaison ne ferme rien', () => {
    const s = spies();
    const { rerender, initial } = arm({ ...s, mode: 'compare' });
    rerender({ ...initial, mode: 'annotate' });
    expect(s.onClear).not.toHaveBeenCalled();
  });

  it('fermer la comparaison sort du mode', () => {
    const s = spies();
    const { rerender, initial } = arm({ ...s, mode: 'compare', hasB: true });
    rerender({ ...initial, mode: 'compare', hasB: false });
    expect(s.onMode).toHaveBeenCalledWith('explore');
  });

  it('un B choisi ailleurs (en-tête vidéo, session live) arme le mode', () => {
    const s = spies();
    const { rerender, initial } = arm(s);
    rerender({ ...initial, hasB: true });
    expect(s.onMode).toHaveBeenCalledWith('compare');
  });

  it('n’impose pas le wipe quand c’est le B qui a armé le mode', () => {
    // La vidéo qui coche deux versions d'un coup veut sa grille 2×2 : basculer en wipe au
    // passage lui volerait son affichage.
    const s = spies();
    const { rerender, initial } = arm(s);
    rerender({ ...initial, hasB: true });
    // Ce que fait le parent en réponse à `onMode('compare')`.
    rerender({ ...initial, hasB: true, mode: 'compare' });
    expect(s.onCompareMode).not.toHaveBeenCalled();
  });

  it('impose le wipe quand c’est l’utilisateur qui arme le segment', () => {
    const s = spies();
    const { rerender, initial } = arm({ ...s, hasB: true });
    rerender({ ...initial, hasB: true, mode: 'compare' });
    expect(s.onCompareMode).toHaveBeenCalledWith('wipe');
  });

  it('reprend le premier média après une fermeture puis un nouvel armement', () => {
    const s = spies();
    const { rerender, initial } = arm({ ...s, firstB: 42 });
    rerender({ ...initial, mode: 'compare', firstB: 42 });
    rerender({ ...initial, mode: 'explore', firstB: 42 });
    rerender({ ...initial, mode: 'compare', firstB: 42 });
    expect(s.onSetB).toHaveBeenCalledTimes(2);
  });
});

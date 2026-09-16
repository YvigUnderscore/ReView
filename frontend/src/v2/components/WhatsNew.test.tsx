// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import WhatsNew from './WhatsNew';

/**
 * Combien de requêtes le panneau « Nouveautés » ajoute au premier écran : zéro.
 *
 * Il était monté par la coquille, donc sur **toute** page authentifiée, et partait chercher
 * `/docs/CHANGELOG.md` au montage — une requête de plus dans la rafale du premier écran,
 * pour un dialogue ouvert une fois par trimestre. Le contenu ne sert qu'à deux choses :
 * décider de la pastille, et remplir le dialogue. Ni l'une ni l'autre n'est urgente : la
 * requête attend que le navigateur n'ait plus rien à faire.
 */

const CHANGELOG = '# Changelog\n\n## 2026-09 — Bande de montage\n\nDu texte.\n';

function renderPanel() {
  const idles: (() => void)[] = [];
  const fetchSpy = vi.fn(() => Promise.resolve(new Response(CHANGELOG)));
  vi.stubGlobal('fetch', fetchSpy);
  // `requestIdleCallback` n'existe pas sous happy-dom : on le fournit pour pouvoir décider
  // du moment exact où le navigateur « se libère ».
  const previous = window.requestIdleCallback;
  window.requestIdleCallback = ((cb: () => void) => {
    idles.push(cb);
    return idles.length;
  }) as typeof window.requestIdleCallback;

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <WhatsNew collapsed />
    </QueryClientProvider>,
  );
  return {
    fetchSpy,
    restore: () => {
      window.requestIdleCallback = previous;
    },
    /** Joue ce que le navigateur jouerait une fois la page posée. */
    goIdle: () => act(() => idles.splice(0).forEach((cb) => cb())),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('WhatsNew', () => {
  it('n’émet aucune requête au montage', async () => {
    const { fetchSpy, restore } = renderPanel();
    // Laisse passer les effets et les micro-tâches : si une requête devait partir, elle
    // serait partie.
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    restore();
  });

  it('va chercher le changelog quand le navigateur se libère, et une seule fois', async () => {
    const { fetchSpy, goIdle, restore } = renderPanel();
    goIdle();
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    expect(fetchSpy).toHaveBeenCalledWith('/docs/CHANGELOG.md');
    // La pastille et le bouton n'apparaissent qu'ensuite — c'était déjà le cas avant.
    expect(await screen.findByRole('button')).toBeInTheDocument();
    restore();
  });
});

// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import WhatsNew from './WhatsNew';

/**
 * Ce que le panneau « Nouveautés » coûte au premier écran (F6).
 *
 * Il est monté par la coquille, donc sur **toute** page authentifiée, et il partait chercher
 * les 24 568 octets de `/docs/CHANGELOG.md` — non compressés, nginx servant ce `.md` en
 * `application/octet-stream` — pour un dialogue ouvert une fois par trimestre. Avant
 * ouverture il n'a pourtant besoin que du titre de la dernière entrée, c'est-à-dire du
 * premier `## ` du fichier : une requête `Range` de 2 ko suffit, et le document entier
 * n'arrive qu'à l'ouverture réelle.
 *
 * Les trois propriétés gardées ici : rien au montage, rien que l'en-tête ensuite, le
 * document entier seulement à l'ouverture — et la pastille qui continue de fonctionner.
 */

const LATEST = '2026-09 — Bande de montage';
const CHANGELOG = [
  '# Changelog',
  '',
  'Product release notes, newest first.',
  '',
  `## ${LATEST}`,
  '',
  'Du texte.',
  '',
  '## 2026-08 — Plus ancien',
  '',
  "D'autre texte.",
  '',
].join('\n');

/** Ce que renvoie un serveur qui honore `Range` : coupé au milieu d'une ligne. */
const PARTIAL = `${CHANGELOG.split('\n').slice(0, 6).join('\n')}\nDu te`;

const SEEN_KEY = 'review:changelog-seen';

/** En-tête `Range` de l'appel numéro `n`, ou undefined si l'appel n'en portait pas. */
const rangeOf = (spy: ReturnType<typeof vi.fn>, n: number): string | undefined => {
  const init = spy.mock.calls[n]?.[1] as { headers?: Record<string, string> } | undefined;
  return init?.headers?.Range;
};

/**
 * @param honorsRange false simule un serveur qui ignore `Range` (compression à la volée,
 * cache intermédiaire) et renvoie 200 avec tout le fichier.
 */
function renderPanel({ honorsRange = true } = {}) {
  const idles: (() => void)[] = [];
  const fetchSpy = vi.fn((_url: string, init?: { headers?: Record<string, string> }) =>
    Promise.resolve(
      init?.headers?.Range && honorsRange
        ? new Response(PARTIAL, { status: 206 })
        : new Response(CHANGELOG, { status: 200 }),
    ),
  );
  vi.stubGlobal('fetch', fetchSpy);
  // `requestIdleCallback` n'existe pas sous happy-dom : on le fournit pour pouvoir décider
  // du moment exact où le navigateur « se libère ».
  const previous = window.requestIdleCallback;
  window.requestIdleCallback = ((cb: () => void) => {
    idles.push(cb);
    return idles.length;
  }) as typeof window.requestIdleCallback;

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { container } = render(
    <QueryClientProvider client={client}>
      <WhatsNew collapsed />
    </QueryClientProvider>,
  );
  return {
    fetchSpy,
    container,
    restore: () => {
      window.requestIdleCallback = previous;
    },
    /** Joue ce que le navigateur jouerait une fois la page posée. */
    goIdle: () => act(() => idles.splice(0).forEach((cb) => cb())),
  };
}

beforeEach(() => {
  localStorage.clear();
});

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

  it('ne lit que l’en-tête du changelog quand le navigateur se libère', async () => {
    const { fetchSpy, goIdle, restore } = renderPanel();
    goIdle();
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    expect(fetchSpy.mock.calls[0][0]).toBe('/docs/CHANGELOG.md');
    // 2 ko : dix fois la marge nécessaire pour atteindre le premier `## `, contre 24 568.
    expect(rangeOf(fetchSpy, 0)).toBe('bytes=0-2047');
    expect(await screen.findByRole('button')).toBeInTheDocument();
    restore();
  });

  it('calcule la pastille sur ce seul en-tête, et la retire à l’ouverture', async () => {
    localStorage.setItem(SEEN_KEY, '2026-08 — Plus ancien');
    const { fetchSpy, goIdle, container, restore } = renderPanel();
    goIdle();
    const button = await screen.findByRole('button');
    // La pastille est décidée sans avoir téléchargé autre chose que les 2 ko d'en-tête.
    expect(container.querySelector('.bg-accent-2')).not.toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(rangeOf(fetchSpy, 0)).toBe('bytes=0-2047');

    fireEvent.click(button);
    await waitFor(() => expect(container.querySelector('.bg-accent-2')).toBeNull());
    // Le titre retenu comme « vu » est bien celui lu dans l'en-tête tronqué.
    expect(localStorage.getItem(SEEN_KEY)).toBe(LATEST);
    restore();
  });

  it('ne va chercher le document entier qu’à l’ouverture du panneau', async () => {
    const { fetchSpy, goIdle, restore } = renderPanel();
    goIdle();
    const button = await screen.findByRole('button');
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    fireEvent.click(button);
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
    // Second appel : le fichier complet, donc sans `Range`.
    expect(rangeOf(fetchSpy, 1)).toBeUndefined();
    // Et les deux entrées du fichier, rendues (le moteur markdown arrive par import()).
    expect(await screen.findByText(LATEST)).toBeInTheDocument();
    expect(await screen.findByText('2026-08 — Plus ancien')).toBeInTheDocument();
    restore();
  });

  it('ne télécharge pas deux fois quand le serveur ignore Range', async () => {
    const { fetchSpy, goIdle, restore } = renderPanel({ honorsRange: false });
    goIdle();
    const button = await screen.findByRole('button');
    expect(rangeOf(fetchSpy, 0)).toBe('bytes=0-2047');

    fireEvent.click(button);
    // Le serveur a déjà tout envoyé : redemander le même fichier serait payer deux fois.
    expect(await screen.findByText(LATEST)).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    restore();
  });
});

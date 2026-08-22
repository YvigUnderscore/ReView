// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithProviders';
import { EMPTY_SEARCH, type SearchResults } from '../lib/searchApi';
import CommandPalette from './CommandPalette';

/**
 * Palette Ctrl+K — ce qu'un superviseur doit y trouver.
 *
 * La recherche ne couvrait que cinq types d'entités : la chaîne la plus tapée du studio
 * (`SH0120_comp_v012`) et la phrase dite en review (« enlever le reflet ») ne rendaient
 * rien. Ce test monte la palette avec les dix familles servies par `GET /api/search` et
 * vérifie qu'elles s'affichent, qu'elles mènent quelque part, et que la frappe n'inonde pas
 * le serveur.
 */

const RESULTS: SearchResults = {
  ...EMPTY_SEARCH,
  shots: [{ id: 3, code: 'SH0120', name: 'Casque', projectId: 1 }],
  versions: [
    { id: 12, name: 'v012', mediaId: 88, taskId: 4, assetId: null, context: 'SH0120 · comp' },
    { id: 13, name: 'v013', mediaId: null, taskId: null, assetId: null, context: 'SH0120 · comp' },
  ],
  media: [{ id: 88, name: 'SH0120_comp_v012.mov', kind: 'VIDEO', context: 'SH0120 · comp · v012' }],
  playlists: [{ id: 5, name: 'Dailies jeudi', projectName: 'Alpha' }],
  comments: [
    {
      id: 51,
      mediaObjectId: 88,
      excerpt: 'Enlever le reflet sur le casque',
      authorName: 'ana',
      createdAt: '2026-08-21T10:00:00.000Z',
      context: 'SH0120 · SH0120_comp_v012.mov',
    },
  ],
  people: [
    { id: 2, name: 'ana', jobTitle: 'Compositing' },
    { id: 3, name: null, jobTitle: null },
  ],
};

function mount(results: SearchResults = RESULTS) {
  const onOpenChange = vi.fn();
  const view = renderWithProviders(
    <CommandPalette
      open
      onOpenChange={onOpenChange}
      onShortcuts={() => undefined}
      onToggleSidebar={() => undefined}
    />,
    { api: { 'GET /api/search': () => results } },
  );
  return { ...view, onOpenChange };
}

/** Le champ de la palette (cmdk le marque d'un attribut stable). */
const input = (): HTMLInputElement => {
  const el = document.querySelector('[cmdk-input]');
  if (!(el instanceof HTMLInputElement)) throw new Error('palette input not found');
  return el;
};

/** Laisse passer le debounce sans rien attendre de précis. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 400));

describe('CommandPalette — ce que l’on cherche vraiment', () => {
  it('trouve un média par son nom de fichier', async () => {
    const { user } = mount();
    await user.type(input(), 'SH0120');
    expect(await screen.findByText('SH0120_comp_v012.mov')).toBeInTheDocument();
    expect(screen.getByText('SH0120 · comp · v012')).toBeInTheDocument();
  });

  it('trouve une version par son numéro', async () => {
    const { user } = mount();
    await user.type(input(), 'v012');
    expect(await screen.findByText('v012')).toBeInTheDocument();
  });

  it('trouve un plan par le texte d’une note de review', async () => {
    const { user } = mount();
    await user.type(input(), 'reflet');
    expect(await screen.findByText('Enlever le reflet sur le casque')).toBeInTheDocument();
    expect(screen.getByText('ana · SH0120 · SH0120_comp_v012.mov')).toBeInTheDocument();
  });

  it('trouve aussi les playlists et les personnes', async () => {
    const { user } = mount();
    await user.type(input(), 'ana');
    expect(await screen.findByText('Dailies jeudi')).toBeInTheDocument();
    expect(screen.getByText('Compositing')).toBeInTheDocument();
  });

  it('affiche un repli lisible pour un compte sans nom', async () => {
    const { user } = mount();
    await user.type(input(), 'ana');
    await screen.findByText('Compositing');
    // La clé est posée par `logs/i18n-lots/lot-recherche.json` ; c'est sa présence qui
    // compte ici, pas sa traduction.
    expect(screen.getAllByText(/palette\.person\.unnamed|Account without a name/)).not.toHaveLength(0);
  });
});

describe('CommandPalette — navigation', () => {
  it('ouvre la review du média choisi', async () => {
    const { user, currentPath, onOpenChange } = mount();
    await user.type(input(), 'SH0120');
    await user.click(await screen.findByText('SH0120_comp_v012.mov'));
    expect(currentPath()).toBe('/review/88');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('ouvre la review à la note choisie', async () => {
    const { user, currentPath } = mount();
    await user.type(input(), 'reflet');
    await user.click(await screen.findByText('Enlever le reflet sur le casque'));
    expect(currentPath()).toBe('/review/88?comment=51');
  });

  it('envoie une version sur son média le plus récent', async () => {
    const { user, currentPath } = mount();
    await user.type(input(), 'v012');
    await user.click(await screen.findByText('v012'));
    expect(currentPath()).toBe('/review/88');
  });

  it('désactive une version dont aucun média n’est visible plutôt que de mener nulle part', async () => {
    const { user } = mount();
    await user.type(input(), 'v013');
    const item = (await screen.findByText('v013')).closest('[cmdk-item]');
    expect(item).toHaveAttribute('aria-disabled', 'true');
  });

  it('ouvre la fiche d’une personne', async () => {
    const { user, currentPath } = mount();
    await user.type(input(), 'ana');
    await user.click(await screen.findByText('Compositing'));
    expect(currentPath()).toBe('/users/2');
  });
});

describe('CommandPalette — la frappe n’inonde pas le serveur', () => {
  it('n’interroge pas le serveur sur un seul caractère', async () => {
    const { user, api } = mount();
    await user.type(input(), 'S');
    await settle();
    expect(api.called('GET /api/search')).toHaveLength(0);
  });

  it('ne lance qu’une requête pour une chaîne tapée d’un trait', async () => {
    const { user, api } = mount();
    await user.type(input(), 'SH0120');
    await screen.findByText('SH0120_comp_v012.mov');
    await settle();
    const calls = api.called('GET /api/search');
    expect(calls).toHaveLength(1);
    expect(calls[0].url.searchParams.get('q')).toBe('SH0120');
  });

  it('annonce l’absence de résultat sans effacer la saisie', async () => {
    const { user } = mount(EMPTY_SEARCH);
    await user.type(input(), 'zzzz');
    await settle();
    expect(input().value).toBe('zzzz');
    expect(screen.getByText(/palette\.empty|No results/)).toBeInTheDocument();
  });
});

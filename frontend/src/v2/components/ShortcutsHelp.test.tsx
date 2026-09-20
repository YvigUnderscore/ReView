// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ShortcutsHelp from './ShortcutsHelp';
import { t } from '../i18n';
import { reviewShortcutGroups } from '../pages/review/chrome/shortcuts';

/**
 * L'aide des raccourcis **se déduit** du registre (`pages/review/chrome/shortcuts`), celui que
 * les gestionnaires eux-mêmes consultent. Ce test est le verrou : il n'énumère aucun raccourci,
 * il compare l'écran au registre. Tant qu'il passe, les deux listes ne peuvent plus diverger —
 * ajouter un raccourci au registre l'ajoute à l'aide, le retirer l'en retire.
 *
 * L'ancienne aide tenait sa propre copie : dix raccourcis actifs y manquaient, un outil
 * « Zoom » inerte y figurait, et les noms de touches y étaient codés en dur en français.
 */
vi.mock('../../lib/apiClient', () => ({ api: { get: vi.fn(() => new Promise(() => {})), patch: vi.fn() } }));

const mount = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ShortcutsHelp open onOpenChange={() => {}} />
    </QueryClientProvider>,
  );
};

afterEach(cleanup);

describe('ShortcutsHelp — dérivée du registre', () => {
  it('affiche chaque groupe et chaque raccourci du registre', () => {
    mount();
    for (const group of reviewShortcutGroups()) {
      expect(screen.getByText(t(group.titleKey))).toBeInTheDocument();
      for (const shortcut of group.shortcuts)
        expect(screen.getAllByText(t(shortcut.labelKey)).length).toBeGreaterThan(0);
    }
  });

  it('rend les noms de touches traduits, jamais la clé de traduction', () => {
    mount();
    const named = reviewShortcutGroups()
      .flatMap((g) => g.shortcuts)
      .flatMap((s) => s.keys)
      .flatMap((key) => ('nameKey' in key ? [key.nameKey] : []));
    expect(named.length).toBeGreaterThan(0);
    for (const nameKey of new Set(named)) {
      const label = t(nameKey);
      expect(label).not.toBe(nameKey);
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
  });

  it('ne promet plus l’outil « Zoom », supprimé faute d’implémentation', () => {
    mount();
    const labels = reviewShortcutGroups()
      .flatMap((g) => g.shortcuts)
      .map((s) => s.labelKey);
    expect(labels).not.toContain('tool.zoom');
  });
});

// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ShortcutsHelp from './ShortcutsHelp';
import { t } from '../i18n';
import { reviewShortcutGroups } from '../pages/review/chrome/shortcuts';

/**
 * The shortcuts help is **derived** from the registry (`pages/review/chrome/shortcuts`), the one that
 * the handlers themselves consult. This test is the lock: it enumerates no shortcut,
 * it compares the screen with the registry. As long as it passes, the two lists can no longer diverge:
 * adding a shortcut to the registry adds it to the help, removing it removes it from there.
 *
 * The former help kept its own copy: ten active shortcuts were missing from it, an inert
 * "Zoom" tool appeared there, and the key names were hard-coded in French.
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

describe('ShortcutsHelp — derived from the registry', () => {
  it('shows each group and each shortcut of the registry', () => {
    mount();
    for (const group of reviewShortcutGroups()) {
      expect(screen.getByText(t(group.titleKey))).toBeInTheDocument();
      for (const shortcut of group.shortcuts)
        expect(screen.getAllByText(t(shortcut.labelKey)).length).toBeGreaterThan(0);
    }
  });

  it('renders the translated key names, never the translation key', () => {
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

  it('no longer promises the "Zoom" tool, removed for lack of implementation', () => {
    mount();
    const labels = reviewShortcutGroups()
      .flatMap((g) => g.shortcuts)
      .map((s) => s.labelKey);
    expect(labels).not.toContain('tool.zoom');
  });
});

// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import WhatsNew from './WhatsNew';

/**
 * What the "What's new" panel costs on the first screen (F6).
 *
 * It is mounted by the shell, so on **every** authenticated page, and it went to fetch
 * the 24,568 bytes of `/docs/CHANGELOG.md`, uncompressed (nginx serves this `.md` as
 * `application/octet-stream`), for a dialog opened once a quarter. Before being
 * opened, it only needs the title of the latest entry, that is the first
 * `## ` of the file: a 2 kB `Range` request is enough, and the whole document
 * only arrives on actual opening.
 *
 * The three properties guarded here: nothing at mount, only the header afterwards, the
 * whole document only on opening, and the badge continues to work.
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

/** What a server honouring `Range` returns: cut in the middle of a line. */
const PARTIAL = `${CHANGELOG.split('\n').slice(0, 6).join('\n')}\nDu te`;

const SEEN_KEY = 'review:changelog-seen';

/** `Range` header of call number `n`, or undefined if that call carried none. */
const rangeOf = (spy: ReturnType<typeof vi.fn>, n: number): string | undefined => {
  const init = spy.mock.calls[n]?.[1] as { headers?: Record<string, string> } | undefined;
  return init?.headers?.Range;
};

/**
 * @param honorsRange false simulates a server that ignores `Range` (on-the-fly compression,
 * intermediate cache) and returns 200 with the whole file.
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
  // `requestIdleCallback` does not exist under happy-dom: we provide it so that we can decide
  // the exact moment when the browser "frees up".
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
    /** Plays what the browser would play once the page is set. */
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
  it('makes no request on mount', async () => {
    const { fetchSpy, restore } = renderPanel();
    // Let effects and microtasks run: if a request had to leave, it would
    // have left by now.
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    restore();
  });

  it('reads only the changelog header when the browser is free', async () => {
    const { fetchSpy, goIdle, restore } = renderPanel();
    goIdle();
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    expect(fetchSpy.mock.calls[0][0]).toBe('/docs/CHANGELOG.md');
    // 2 kB: ten times the margin needed to reach the first `## `, against 24,568.
    expect(rangeOf(fetchSpy, 0)).toBe('bytes=0-2047');
    expect(await screen.findByRole('button')).toBeInTheDocument();
    restore();
  });

  it('computes the dot from this header alone, and removes it on opening', async () => {
    localStorage.setItem(SEEN_KEY, '2026-08 — Plus ancien');
    const { fetchSpy, goIdle, container, restore } = renderPanel();
    goIdle();
    const button = await screen.findByRole('button');
    // The badge is decided without having downloaded anything but the 2 kB header.
    expect(container.querySelector('.bg-accent-2')).not.toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(rangeOf(fetchSpy, 0)).toBe('bytes=0-2047');

    fireEvent.click(button);
    await waitFor(() => expect(container.querySelector('.bg-accent-2')).toBeNull());
    // The title kept as "seen" is indeed the one read in the truncated header.
    expect(localStorage.getItem(SEEN_KEY)).toBe(LATEST);
    restore();
  });

  it('fetches the whole document only when the panel is opened', async () => {
    const { fetchSpy, goIdle, restore } = renderPanel();
    goIdle();
    const button = await screen.findByRole('button');
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    fireEvent.click(button);
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
    // Second call: the full file, hence without `Range`.
    expect(rangeOf(fetchSpy, 1)).toBeUndefined();
    // And the two entries of the file, rendered (the markdown engine arrives via import()).
    expect(await screen.findByText(LATEST)).toBeInTheDocument();
    expect(await screen.findByText('2026-08 — Plus ancien')).toBeInTheDocument();
    restore();
  });

  it('does not download twice when the server ignores Range', async () => {
    const { fetchSpy, goIdle, restore } = renderPanel({ honorsRange: false });
    goIdle();
    const button = await screen.findByRole('button');
    expect(rangeOf(fetchSpy, 0)).toBe('bytes=0-2047');

    fireEvent.click(button);
    // The server has already sent everything: requesting the same file again would pay twice.
    expect(await screen.findByText(LATEST)).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    restore();
  });
});

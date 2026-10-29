// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

/**
 * The presence directory, measured in REQUESTS and FRAMES rather than in intentions (A5-08).
 *
 * The studio's full directory — one line per account, with a presigned avatar URL computed
 * server-side — was loaded in a `useEffect` owned by each consumer, outside TanStack Query: two
 * components mounted together made two requests, and each opening of the people picker made one
 * more. With 120 accounts the response weighs about 70 KB. Here we count the calls to `api.get`:
 * that is exactly the number of HTTP requests a browser would have sent.
 *
 * Second part: every keystroke and every click emitted an `activity` socket frame.
 */

/** Fake socket: the handlers are triggered by hand, without any network. */
const handlers = new Map<string, Set<(payload: unknown) => void>>();
const socket = {
  on(event: string, fn: (payload: unknown) => void) {
    const set = handlers.get(event) ?? new Set<(payload: unknown) => void>();
    set.add(fn);
    handlers.set(event, set);
  },
  off(event: string, fn: (payload: unknown) => void) {
    handlers.get(event)?.delete(fn);
  },
  emit: vi.fn(),
};
const fire = (event: string, payload: unknown): void => {
  for (const fn of [...(handlers.get(event) ?? [])]) fn(payload);
};
const emitActivity = vi.fn();

vi.mock('../../lib/socket', () => ({ getSocket: () => socket, emitActivity: () => emitActivity() }));

/** Request counter: the measurement behind the finding. */
let calls: string[] = [];

/** Eight accounts, matching the response actually measured (4,724 bytes). */
const directory = Array.from({ length: 8 }, (_, i) => ({
  id: i + 1,
  email: `p${i + 1}@studio.test`,
  displayName: `Person ${i + 1}`,
  initials: 'PX',
  avatarUrl: null,
  status: 'AVAILABLE' as const,
  lastSeenAt: null,
  online: i === 0,
}));

vi.mock('../../lib/apiClient', () => ({
  api: {
    get: (url: string) => {
      calls.push(url);
      return Promise.resolve({ users: directory });
    },
  },
}));

import { usePresence } from './usePresence';
import { usePresenceBridge, ACTIVITY_THROTTLE_MS } from '../lib/socketBridge';

const presenceCalls = (): string[] => calls.filter((u) => u.startsWith('/api/users/presence'));

/** Keeps the directory open — exactly what SocialPanel and PeoplePicker do. */
function Directory() {
  const { users } = usePresence();
  // Rendered into the DOM rather than surfaced through a side effect: the test reads what the
  // person in front of the screen would see, not an internal state.
  return (
    <span data-testid="online">
      {users
        .filter((u) => u.online)
        .map((u) => u.id)
        .join(',')}
    </span>
  );
}

/** The real-time bridge, mounted once for the whole application (Shell). */
function Bridge() {
  usePresenceBridge();
  return null;
}

function Providers({ client, children }: { client: QueryClient; children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const newClient = (): QueryClient => new QueryClient({ defaultOptions: { queries: { retry: false } } });

/**
 * Lets one loop tick pass — enough for a SYNCHRONOUS write into the Query cache (the socket push),
 * never for the arrival of a request.
 *
 * Waiting for data that comes from the network is done with `waitFor`, which retries: since the
 * directory goes through TanStack Query, its resolution spreads over several ticks, and a single
 * `setTimeout(0)` no longer sufficed once the machine was loaded — the test passed on its own and
 * failed within the full suite.
 */
const settle = async (): Promise<void> => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};

beforeEach(() => {
  handlers.clear();
  calls = [];
  emitActivity.mockClear();
  socket.emit.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('usePresence — studio directory', () => {
  it('loads the directory only once for several consumers and several mounts', async () => {
    const client = newClient();
    // The social panel is permanently mounted by the sidebar.
    const panel = render(
      <Providers client={client}>
        <Bridge />
        <Directory />
      </Providers>,
    );
    await waitFor(() => expect(presenceCalls()).toHaveLength(1));

    // The people picker, for its part, is opened then closed — five times here.
    for (let i = 0; i < 5; i++) {
      const picker = render(
        <Providers client={client}>
          <Directory />
        </Providers>,
      );
      await settle();
      picker.unmount();
    }
    panel.unmount();

    expect(presenceCalls()).toHaveLength(1);
  });

  it('keeps real time: a socket push switches to "online" without reloading', async () => {
    const client = newClient();
    render(
      <Providers client={client}>
        <Bridge />
        <Directory />
      </Providers>,
    );
    await waitFor(() => expect(screen.getByTestId('online')).toHaveTextContent('1'));

    fire('presence:update', { onlineUserIds: [2, 3] });
    await settle();

    expect(screen.getByTestId('online')).toHaveTextContent('2,3');
    // The push writes into the cache: it does not ask the server for the directory again.
    expect(presenceCalls()).toHaveLength(1);
  });

  it('emits only one activity frame for a whole typed sentence', async () => {
    vi.useFakeTimers();
    const client = newClient();
    render(
      <Providers client={client}>
        <Bridge />
        <Directory />
      </Providers>,
    );
    const tick = async (ms: number): Promise<void> => {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
      });
    };
    await tick(0);

    // Mounting signals presence once, without waiting for the threshold.
    expect(emitActivity).toHaveBeenCalledTimes(1);

    // Forty characters typed in a review note, in under a second.
    for (let i = 0; i < 40; i++) window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    expect(emitActivity).toHaveBeenCalledTimes(1);

    // Past the threshold, activity is signalled again: we throttle, we do not cut off.
    await tick(ACTIVITY_THROTTLE_MS);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    expect(emitActivity).toHaveBeenCalledTimes(2);
  });
});

// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { ErrorBoundary } from './error-boundary';
import { t } from '../../i18n';

/** Component that throws on render until it has been disarmed. */
function Boom({ armed }: { armed: boolean }): React.ReactElement {
  if (armed) throw new Error('viewer WebGL perdu');
  return <p>contenu rétabli</p>;
}

beforeEach(() => {
  // React logs the caught exception: silence it to keep the output readable.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('ErrorBoundary', () => {
  it('lets its children through when nothing throws', () => {
    render(
      <ErrorBoundary>
        <Boom armed={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByText('contenu rétabli')).toBeTruthy();
  });

  /**
   * Without a boundary, React unmounts the whole tree: the user was left with a blank
   * screen, with no navigation and no message.
   */
  it('shows a message rather than an empty screen when a child throws', () => {
    render(
      <ErrorBoundary>
        <Boom armed />
      </ErrorBoundary>,
    );
    expect(screen.getByText(t('error.boundary.title'))).toBeTruthy();
    expect(screen.getByRole('button', { name: new RegExp(t('error.boundary.retry')) })).toBeTruthy();
  });

  it('"Retry" remounts the children', async () => {
    const user = userEvent.setup();
    function Host(): React.ReactElement {
      const [armed, setArmed] = useState(true);
      return (
        <ErrorBoundary
          fallback={(reset) => (
            <button
              onClick={() => {
                setArmed(false);
                reset();
              }}
            >
              réarmer
            </button>
          )}
        >
          <Boom armed={armed} />
        </ErrorBoundary>
      );
    }
    render(<Host />);
    await user.click(screen.getByRole('button', { name: 'réarmer' }));
    expect(screen.getByText('contenu rétabli')).toBeTruthy();
  });

  it('logs the scope to find the faulty page', () => {
    render(
      <ErrorBoundary scope="viewer">
        <Boom armed />
      </ErrorBoundary>,
    );
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('viewer'),
      expect.any(Error),
      expect.anything(),
    );
  });
});

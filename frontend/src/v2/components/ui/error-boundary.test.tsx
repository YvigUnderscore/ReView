// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { ErrorBoundary } from './error-boundary';
import { t } from '../../i18n';

/** Composant qui jette au rendu tant qu'on ne l'a pas désarmé. */
function Boom({ armed }: { armed: boolean }): React.ReactElement {
  if (armed) throw new Error('viewer WebGL perdu');
  return <p>contenu rétabli</p>;
}

beforeEach(() => {
  // React journalise l'exception attrapée : on la fait taire pour garder la sortie lisible.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('ErrorBoundary', () => {
  it('laisse passer ses enfants quand rien ne jette', () => {
    render(
      <ErrorBoundary>
        <Boom armed={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByText('contenu rétabli')).toBeTruthy();
  });

  /**
   * Sans frontière, React démonte l'arbre entier : l'utilisateur se retrouvait devant un
   * écran blanc, sans navigation ni message.
   */
  it('affiche un message et non un écran vide quand un enfant jette', () => {
    render(
      <ErrorBoundary>
        <Boom armed />
      </ErrorBoundary>,
    );
    expect(screen.getByText(t('error.boundary.title'))).toBeTruthy();
    expect(screen.getByRole('button', { name: new RegExp(t('error.boundary.retry')) })).toBeTruthy();
  });

  it('« Réessayer » remonte les enfants', async () => {
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

  it('journalise la portée pour retrouver la page fautive', () => {
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

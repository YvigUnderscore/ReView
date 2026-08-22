// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Socle des tests **de rendu** (Testing Library).
 *
 * Il complète `vitest.setup.ts` — qui, lui, corrige une incompatibilité WebAssembly et n'a
 * rien à voir avec le DOM. Ici on installe ce sans quoi un composant réel refuse de monter
 * sous happy-dom : les matchers `jest-dom`, le démontage entre deux tests, et les quelques
 * API navigateur que happy-dom n'implémente pas mais dont l'application se sert sans
 * précaution (observateurs, `matchMedia`, lecture média).
 *
 * Règle : **on ne stub que ce qui manque**. Un `if (!(x in window))` protège chaque ajout,
 * pour qu'une version ultérieure de happy-dom reprenne la main d'elle-même et qu'aucun test
 * ne se retrouve à vérifier notre bouchon plutôt que le navigateur.
 */

import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Démontage systématique : sans lui, deux tests d'un même fichier partagent le DOM et
// `getByRole` remonte l'écran précédent — l'erreur la plus coûteuse à diagnostiquer.
afterEach(cleanup);

/** Observateur inerte : ne déclenche jamais, ce qui est le comportement attendu hors navigateur. */
class InertObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): [] {
    return [];
  }
}

const w = globalThis as unknown as Record<string, unknown>;

// `IntersectionObserver` : sentinelles de pagination, lazy-loading des vignettes. Sans lui,
// `ListSentinel` lève à la première liste rendue.
if (!('IntersectionObserver' in w)) w.IntersectionObserver = InertObserver;
// `ResizeObserver` : rails d'onglets, panneaux redimensionnables, virtualisation.
if (!('ResizeObserver' in w)) w.ResizeObserver = InertObserver;

if (typeof window !== 'undefined') {
  if (!window.matchMedia) {
    window.matchMedia = (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    });
  }
  // Radix (dialogs, menus) et le fil de commentaires appellent `scrollIntoView` au montage.
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = function () {};
  // happy-dom ne joue rien : `play()` doit néanmoins rendre une promesse résolue, sinon
  // chaque `void v.play().catch(...)` du lecteur devient un rejet non capturé.
  if (typeof HTMLMediaElement !== 'undefined') {
    HTMLMediaElement.prototype.play = function () {
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function () {};
    HTMLMediaElement.prototype.load = function () {};
  }
  // Aucun test de rendu ne doit atteindre le réseau : `renderWithProviders` installe un
  // routeur de bouchons, et un composant oublié doit échouer bruyamment plutôt que
  // pendre jusqu'au timeout.
  if (!globalThis.fetch) {
    globalThis.fetch = () => Promise.reject(new Error('fetch is not mocked in this test'));
  }
}

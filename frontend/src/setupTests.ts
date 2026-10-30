// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Base of the **rendering** tests (Testing Library).
 *
 * It complements `vitest.setup.ts`, which fixes a WebAssembly incompatibility and has
 * nothing to do with the DOM. Here we install what a real component needs in order to mount
 * under happy-dom: the `jest-dom` matchers, the teardown between two tests, and the few
 * browser APIs that happy-dom does not implement but the application uses without
 * caution (observers, `matchMedia`, media playback).
 *
 * Rule: **we only stub what is missing**. An `if (!(x in window))` guards each addition,
 * so that a later version of happy-dom takes over by itself and no test
 * ends up checking our stub rather than the browser.
 */

import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Systematic teardown: without it, two tests of the same file share the DOM and
// `getByRole` picks up the previous screen, the most costly error to diagnose.
afterEach(cleanup);

/** Inert observer: never fires, which is the expected behaviour outside a browser. */
class InertObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): [] {
    return [];
  }
}

const w = globalThis as unknown as Record<string, unknown>;

// `IntersectionObserver`: pagination sentinels, lazy loading of thumbnails. Without it,
// `ListSentinel` throws on the first list rendered.
if (!('IntersectionObserver' in w)) w.IntersectionObserver = InertObserver;
// `ResizeObserver`: tab rails, resizable panels, virtualization.
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
  // Radix (dialogs, menus) and the comment thread call `scrollIntoView` on mount.
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = function () {};
  // happy-dom plays nothing: `play()` must nevertheless return a resolved promise, otherwise
  // every `void v.play().catch(...)` of the player becomes an uncaught rejection.
  if (typeof HTMLMediaElement !== 'undefined') {
    HTMLMediaElement.prototype.play = function () {
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function () {};
    HTMLMediaElement.prototype.load = function () {};
  }
  // No rendering test may reach the network: `renderWithProviders` installs a
  // router of stubs, and a forgotten component must fail loudly rather than
  // hang until the timeout.
  if (!globalThis.fetch) {
    globalThis.fetch = () => Promise.reject(new Error('fetch is not mocked in this test'));
  }
}

// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { toast } from 'sonner';
import ToastHost, { TOAST_TOP_OFFSET } from './ToastHost';

/**
 * Toasts used to fall at the bottom right, on the busiest corner of the application. These cases
 * lock in the requested move: at the top, centred, and BELOW the top bar. A
 * toast that started higher would cover the search and the bell, which is exactly
 * what we are trying no longer to hide.
 */

/** happy-dom does not always render a custom property: the attribute is authoritative. */
const cssVar = (el: HTMLElement, name: string): string =>
  el.style.getPropertyValue(name) ||
  (el.getAttribute('style') ?? '')
    .split(';')
    .find((decl) => decl.trim().startsWith(`${name}:`))
    ?.split(':')[1] ||
  '';

/** Mounts the host and raises a toast: without a toast, sonner renders no stack to measure. */
async function mountWithToast(message: string): Promise<HTMLElement> {
  render(<ToastHost theme="dark" />);
  act(() => {
    toast(message);
  });
  await screen.findByText(message);
  const list = document.querySelector('[data-sonner-toaster]');
  if (!(list instanceof HTMLElement)) throw new Error('sonner rendered no toast list');
  return list;
}

describe('ToastHost', () => {
  it('places the stack at the top and centred, no longer in the bottom-right corner', async () => {
    const list = await mountWithToast('sh010_v003 published');
    expect(list.dataset.yPosition).toBe('top');
    expect(list.dataset.xPosition).toBe('center');
  });

  it('offsets it below the top bar, in wide window as in phone window', async () => {
    const list = await mountWithToast('sh020_v001 published');
    expect(cssVar(list, '--offset-top').trim()).toBe(TOAST_TOP_OFFSET);
    expect(cssVar(list, '--mobile-offset-top').trim()).toBe(TOAST_TOP_OFFSET);
    // The header row measures 3.5 rem (`h-14`): above that, the toast would fall on it.
    expect(Number.parseFloat(TOAST_TOP_OFFSET)).toBeGreaterThan(3.5);
  });
});

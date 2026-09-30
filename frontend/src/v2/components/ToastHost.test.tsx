// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { toast } from 'sonner';
import ToastHost, { TOAST_TOP_OFFSET } from './ToastHost';

/**
 * Les toasts tombaient en bas à droite, sur le coin le plus chargé de l'application. Ces cas
 * verrouillent le déplacement demandé : en haut, au centre, et SOUS la barre du haut — un
 * toast qui démarrerait plus haut recouvrirait la recherche et la cloche, c'est-à-dire
 * précisément ce qu'on essaie de ne plus masquer.
 */

/** happy-dom ne rend pas toujours une propriété personnalisée : l'attribut fait foi. */
const cssVar = (el: HTMLElement, name: string): string =>
  el.style.getPropertyValue(name) ||
  (el.getAttribute('style') ?? '')
    .split(';')
    .find((decl) => decl.trim().startsWith(`${name}:`))
    ?.split(':')[1] ||
  '';

/** Monte l'hôte et lève un toast : sans toast, sonner ne rend aucune pile à mesurer. */
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
  it('pose la pile en haut et au centre, plus dans le coin bas droit', async () => {
    const list = await mountWithToast('sh010_v003 published');
    expect(list.dataset.yPosition).toBe('top');
    expect(list.dataset.xPosition).toBe('center');
  });

  it('la décale sous la barre du haut, en fenêtre large comme en fenêtre téléphone', async () => {
    const list = await mountWithToast('sh020_v001 published');
    expect(cssVar(list, '--offset-top').trim()).toBe(TOAST_TOP_OFFSET);
    expect(cssVar(list, '--mobile-offset-top').trim()).toBe(TOAST_TOP_OFFSET);
    // La rangée d'en-tête mesure 3,5 rem (`h-14`) : en deçà, le toast tomberait dessus.
    expect(Number.parseFloat(TOAST_TOP_OFFSET)).toBeGreaterThan(3.5);
  });
});

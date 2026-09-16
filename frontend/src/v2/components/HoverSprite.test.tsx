// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import HoverSprite, { type SpriteData } from './HoverSprite';

/**
 * La planche-contact de survol pèse plusieurs centaines de kilo-octets (jusqu'à 240
 * vignettes de 160 px). La page Reviews en affiche cent par page : tant que personne ne
 * survole, **aucune** ne doit partir sur le réseau.
 *
 * La grandeur mesurée est donc un **nombre de requêtes**, comptées des deux côtés d'où
 * elles peuvent naître : le préchargement JS (`new Image()`) et le fond CSS (une `url()`
 * posée sur un élément rendu est une requête, `opacity: 0` ne la diffère pas — seul
 * `display: none` le ferait).
 */

interface PendingImage {
  url: string;
  /** Simule la fin du téléchargement côté navigateur. */
  load: () => void;
}

/** Requêtes de préchargement observées pendant un test. */
const pending: PendingImage[] = [];

/** `Image` de substitution : elle enregistre la requête au lieu de l'émettre. */
class FakeImage {
  private handlers: Record<string, (() => void)[]> = {};
  private url = '';

  get src(): string {
    return this.url;
  }

  set src(value: string) {
    this.url = value;
    pending.push({ url: value, load: () => (this.handlers.load ?? []).forEach((h) => h()) });
  }

  addEventListener(type: string, fn: () => void): void {
    (this.handlers[type] ??= []).push(fn);
  }

  removeEventListener(type: string, fn: () => void): void {
    this.handlers[type] = (this.handlers[type] ?? []).filter((h) => h !== fn);
  }
}

const sprite = (i: number): SpriteData => ({
  url: `https://minio/sprite-${i}.jpg`,
  count: 24,
  cols: 6,
  rows: 4,
});

/** Une page de cartes, chacune coiffée de son aperçu au survol. */
function Grid({ size }: { size: number }) {
  return (
    <div>
      {Array.from({ length: size }, (_, i) => (
        <div key={i} data-testid={`card-${i}`} className="relative">
          <HoverSprite sprite={sprite(i)} />
        </div>
      ))}
    </div>
  );
}

/** Éléments dont le style réclame une mosaïque au réseau. */
const painted = (root: HTMLElement) => root.querySelectorAll('[style*="minio/sprite-"]').length;

const overlayOf = (index: number) => screen.getByTestId(`card-${index}`).firstElementChild as HTMLElement;

describe('HoverSprite — la mosaïque ne part qu’au survol', () => {
  beforeEach(() => {
    pending.length = 0;
    vi.stubGlobal('Image', FakeImage);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('ne réclame aucune mosaïque sur une page de cent cartes', () => {
    const { container } = render(<Grid size={100} />);

    expect(pending).toHaveLength(0);
    expect(painted(container)).toBe(0);
  });

  it('ne tire que celle qu’on survole, une seule fois, et sans la montrer à moitié', async () => {
    const user = userEvent.setup();
    const { container } = render(<Grid size={100} />);

    await user.hover(overlayOf(7));
    expect(pending.map((p) => p.url)).toEqual(['https://minio/sprite-7.jpg']);
    // Rien n'est encore peint : un fond CSS en cours de chargement apparaîtrait par
    // bandes sous le fondu. La carte montre toujours sa miniature statique.
    expect(painted(container)).toBe(0);
    expect(overlayOf(7).style.opacity).toBe('0');

    act(() => pending[0].load());
    expect(painted(container)).toBe(1);
    expect(overlayOf(7).style.backgroundImage).toContain('sprite-7.jpg');
    expect(overlayOf(7).style.opacity).toBe('1');

    // Le voisin n'a rien demandé.
    expect(overlayOf(8).style.backgroundImage).toBe('');

    // Sortir puis revenir ne redemande rien : le drapeau est collant, le second survol
    // est instantané.
    await user.unhover(overlayOf(7));
    expect(overlayOf(7).style.opacity).toBe('0');
    await user.hover(overlayOf(7));
    expect(pending).toHaveLength(1);
    expect(overlayOf(7).style.opacity).toBe('1');
  });

  it('fait défiler les vignettes une fois la mosaïque chargée', () => {
    vi.useFakeTimers();
    render(<Grid size={3} />);

    // `fireEvent` plutôt que `userEvent` : ce dernier planifie ses gestes sur de vrais
    // délais, que des minuteurs simulés n'avancent pas.
    fireEvent.mouseOver(overlayOf(1));
    act(() => pending[0].load());
    const first = overlayOf(1).style.backgroundPosition;

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(overlayOf(1).style.backgroundPosition).not.toBe(first);
  });
});

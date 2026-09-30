// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { commonZone, containBox } from './compareFit';
import { CompareFitProvider } from './CompareFitProvider';
import { useFitBox } from '../zoom/useFitBox';

/**
 * Le reproche de départ : « en côte-à-côte, la vidéo de droite s'affiche beaucoup plus
 * petite ». Deux fautes derrière, et ce fichier verrouille les deux remèdes — l'ajustement
 * « contain » ne regarde plus la résolution source, et les panes ajustent dans une zone
 * commune plutôt que chacun dans la sienne.
 */
describe('containBox — la résolution source ne décide plus de la taille', () => {
  it('remplit la largeur quand la zone est plus haute que le média', () => {
    expect(containBox({ w: 800, h: 600 }, 16 / 9)).toEqual({ w: 800, h: 450 });
  });

  it('remplit la hauteur quand la zone est plus large que le média', () => {
    const box = containBox({ w: 800, h: 300 }, 16 / 9);
    expect(box.h).toBe(300);
    expect(box.w).toBeCloseTo((300 * 16) / 9, 6);
  });

  it('donne la même boîte à un proxy basse résolution et à son master', () => {
    // 1080p et son proxy 360p : même aspect, donc exactement la même taille à l'écran — et
    // non 640 × 360 perdus au centre d'un pane de 800 de large.
    const zone = { w: 800, h: 600 };
    expect(containBox(zone, 1920 / 1080)).toEqual(containBox(zone, 640 / 360));
  });

  it('ne déforme pas : la boîte garde l’aspect du média, pas celui de la zone', () => {
    const box = containBox({ w: 800, h: 300 }, 4 / 3);
    expect(box.w / box.h).toBeCloseTo(4 / 3, 6);
  });

  it('rend une boîte nulle tant que rien n’est mesurable', () => {
    expect(containBox({ w: 0, h: 0 }, 16 / 9)).toEqual({ w: 0, h: 0 });
    expect(containBox({ w: 800, h: 600 }, 0)).toEqual({ w: 0, h: 0 });
  });
});

describe('commonZone — le rectangle qui tient dans tous les panes', () => {
  it('prend la plus petite largeur et la plus petite hauteur', () => {
    expect(
      commonZone([
        { w: 700, h: 600 },
        { w: 720, h: 660 },
      ]),
    ).toEqual({ w: 700, h: 600 });
  });

  it('ignore un pane pas encore mis en page, qui écraserait tous les autres', () => {
    expect(
      commonZone([
        { w: 800, h: 600 },
        { w: 0, h: 0 },
      ]),
    ).toEqual({ w: 800, h: 600 });
  });

  it('rend null quand aucune zone n’est mesurée', () => {
    expect(commonZone([])).toBeNull();
    expect(commonZone([{ w: 0, h: 500 }])).toBeNull();
  });
});

/**
 * Les panes d'une comparaison n'ont jamais la même hauteur disponible : le maître porte la
 * timeline et le transport sous l'image, les panes B un en-tête ou un HUD. Chacun ajustant
 * chez soi, la même image s'affichait à deux tailles.
 *
 * Ces tests décrivent les deux géométries réelles : le côte-à-côte (deux colonnes de même
 * largeur) et la grille 2×2 (cases basses, où c'est la hauteur qui commande).
 */
function Pane({
  name,
  zone,
  resolution,
}: {
  name: string;
  /** Zone disponible du pane, en pixels — happy-dom ne met rien en page. */
  zone: [number, number];
  /** Résolution du média, d'où vient l'aspect (comme `loadedmetadata` le donnerait). */
  resolution: [number, number];
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { box, setAspect } = useFitBox(ref);

  const attach = (el: HTMLDivElement | null) => {
    if (el) {
      Object.defineProperty(el, 'clientWidth', { configurable: true, value: zone[0] });
      Object.defineProperty(el, 'clientHeight', { configurable: true, value: zone[1] });
    }
    ref.current = el;
  };

  useEffect(() => {
    setAspect(resolution[0] / resolution[1]);
  }, [resolution, setAspect]);

  return (
    <div ref={attach} data-testid={name} data-box={box ? `${Math.round(box.w)}×${Math.round(box.h)}` : ''} />
  );
}

const boxOf = (name: string) => screen.getByTestId(name).getAttribute('data-box');

describe('ajustement partagé des panes de comparaison', () => {
  it('côte à côte : un proxy 360p s’affiche à la taille du master 1080p', () => {
    render(
      <CompareFitProvider>
        <Pane name="a" zone={[700, 600]} resolution={[1920, 1080]} />
        <Pane name="b" zone={[700, 660]} resolution={[640, 360]} />
      </CompareFitProvider>,
    );
    // 700 de large commande : la boîte vaut 700 × 394 des deux côtés, et non 640 × 360
    // (taille source) perdus au centre de la moitié droite.
    expect(boxOf('b')).toBe(boxOf('a'));
    expect(boxOf('a')).toBe('700×394');
  });

  it('grille 2×2 : la case la plus courte commande, les trois panes font la même taille', () => {
    render(
      <CompareFitProvider>
        {/* La case du maître perd la hauteur de sa timeline et de son transport. */}
        <Pane name="a" zone={[800, 300]} resolution={[1920, 1080]} />
        <Pane name="b" zone={[800, 400]} resolution={[640, 360]} />
        <Pane name="c" zone={[800, 400]} resolution={[3840, 2160]} />
      </CompareFitProvider>,
    );
    expect(boxOf('a')).toBe('533×300');
    expect(boxOf('b')).toBe('533×300');
    expect(boxOf('c')).toBe('533×300');
  });

  it('même taille n’est pas même aspect : un média 4:3 garde ses proportions', () => {
    render(
      <CompareFitProvider>
        <Pane name="a" zone={[800, 300]} resolution={[1920, 1080]} />
        <Pane name="b" zone={[800, 400]} resolution={[1440, 1080]} />
      </CompareFitProvider>,
    );
    // Les deux tiennent dans la même zone commune (800 × 300) et la remplissent en hauteur ;
    // l'aspect de chacun est le sien — l'ajustement est un « contain », il ne déforme rien.
    expect(boxOf('a')).toBe('533×300');
    expect(boxOf('b')).toBe('400×300');
  });

  it('un pane pas encore mis en page ne rapetisse pas les autres', () => {
    render(
      <CompareFitProvider>
        <Pane name="a" zone={[800, 600]} resolution={[1920, 1080]} />
        <Pane name="b" zone={[0, 0]} resolution={[1920, 1080]} />
      </CompareFitProvider>,
    );
    expect(boxOf('a')).toBe('800×450');
  });

  it('hors comparaison, chaque pane garde sa propre zone', () => {
    render(
      <>
        <Pane name="a" zone={[800, 600]} resolution={[1920, 1080]} />
        <Pane name="b" zone={[400, 600]} resolution={[1920, 1080]} />
      </>,
    );
    expect(boxOf('a')).toBe('800×450');
    expect(boxOf('b')).toBe('400×225');
  });
});

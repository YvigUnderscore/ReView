// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '../../../test/renderWithProviders';
import HomeGrid from './HomeGrid';
import type { HomeWidgetsPref } from './homeWidgets';
import type { DashboardActivityItem, DashboardData, DashboardProject } from './homeTypes';
import { t } from '../../i18n';

/**
 * L'accueil redimensionnable (lot 13) — « je veux les mêmes réglages de redimensionnement,
 * de fenêtres, etc. qu'à la vue d'ensemble d'un projet ».
 *
 * Ce que ces cas verrouillent, c'est la chaîne complète du geste : la poignée règle les deux
 * axes, la taille retenue part en préférence (une seule écriture), la grille porte l'emprise,
 * le contenu la suit — et un accueil composé **avant** ce lot se relit sans rien perdre.
 */

const project = (id: number): DashboardProject => ({
  id,
  name: `Projet ${String(id)}`,
  thumbnailUrl: null,
  totalTasks: 4,
  approvedTasks: 2,
});

const event = (i: number): DashboardActivityItem => ({
  type: 'media',
  at: `2026-09-20T1${String(i % 10)}:00:00.000Z`,
  label: `Média ${String(i)}`,
  location: 'SEQ010 / SH020',
  author: 'Ada',
  taskId: null,
  mediaId: i,
});

const data: DashboardData = {
  latestReviews: [],
  activity: Array.from({ length: 15 }, (_, i) => event(i + 1)),
  myTasks: [],
  recentProjects: [1, 2, 3, 4, 5].map(project),
  stats: {
    projects: 5,
    mediaInReview: 3,
    comments: 12,
    mediaInReview7d: 1,
    comments7d: 2,
    myRetakes: 0,
    awaitingMyReview: 0,
  },
};

const mount = (pref: HomeWidgetsPref | undefined, editing = false) => {
  const onPref = vi.fn();
  const result = renderWithProviders(
    <HomeGrid
      data={data}
      pref={pref}
      editing={editing}
      onPref={onPref}
      onHide={() => {}}
      onEnterEdit={() => {}}
    />,
  );
  return { ...result, onPref };
};

const sectionOf = (id: string) => document.querySelector<HTMLElement>(`section[data-widget="${id}"]`);
const handleOf = (id: string) =>
  document.querySelector<HTMLElement>(
    `section[data-widget="${id}"] button[title="${t('overview.widget.resizeHint')}"]`,
  );
/** Tuiles de projet réellement montrées — le lien « tous les projets » n'en est pas une. */
const projectTiles = () =>
  Array.from(sectionOf('projects')?.querySelectorAll('a') ?? [])
    .map((a) => a.getAttribute('href') ?? '')
    .filter((href) => href.startsWith('/projects/'));

const rowsOf = (id: string) =>
  sectionOf(id)
    ?.className.split(' ')
    .find((c) => c.startsWith('row-span-'));

describe('HomeGrid — l’emprise des blocs', () => {
  it('pose une grille en rangées qui tasse, et non plus des blocs alignés par le haut', () => {
    // Un bloc court ouvrait sous lui un trou que son voisin ne pouvait pas combler : c'est
    // `items-start` qui le produisait, et `grid-flow-row-dense` qui le referme.
    mount(undefined);
    const grid = sectionOf('stats')?.parentElement;
    expect(grid?.className).toContain('grid-flow-row-dense');
    expect(grid?.className).toContain('auto-rows-[5rem]');
    expect(grid?.className).not.toContain('items-start');
  });

  it('rend la hauteur par défaut de chaque bloc', () => {
    mount(undefined);
    expect(rowsOf('stats')).toBe('row-span-2');
    expect(rowsOf('activity')).toBe('row-span-4');
  });

  it('rend la hauteur enregistrée', () => {
    mount({ settings: { activity: { span: 8, rows: 6 } } });
    expect(rowsOf('activity')).toBe('row-span-6');
    expect(sectionOf('activity')?.className).toContain('xl:col-span-8');
  });

  it('relit un accueil composé AVANT les rangées', () => {
    // L'ancienne échelle se traduit à la lecture : personne ne perd le bloc haut qu'il
    // s'était réglé, et la préférence n'est pas réécrite pour autant.
    const { onPref } = mount({ settings: { activity: { height: 'tall' }, stats: { height: 'short' } } });
    expect(rowsOf('activity')).toBe('row-span-5');
    expect(rowsOf('stats')).toBe('row-span-2');
    expect(onPref).not.toHaveBeenCalled();
  });
});

describe('HomeGrid — la poignée enregistre', () => {
  it('règle la largeur et la hauteur, en une seule écriture de préférence', () => {
    const { onPref } = mount(undefined, true);
    const handle = handleOf('activity');
    expect(handle).not.toBeNull();
    if (!handle) return;

    fireEvent.keyDown(handle, { key: 'ArrowDown' });
    expect(onPref).toHaveBeenCalledWith({ settings: { activity: { span: 6, rows: 5 } } });

    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    // Largeurs offertes à ce bloc : 3, 4, 6, 8 — la suivante après 6 est 8.
    expect(onPref).toHaveBeenLastCalledWith({ settings: { activity: { span: 8, rows: 4 } } });
    expect(onPref).toHaveBeenCalledTimes(2);
  });

  it('ne montre aucune poignée hors composition', () => {
    mount(undefined);
    expect(handleOf('activity')).toBeNull();
  });
});

describe('HomeGrid — le contenu suit la taille', () => {
  it('montre plus d’activité dans un bloc plus haut', () => {
    // Trois lignes : c'est le plancher du modèle de taille, où mieux vaut une liste qui
    // déborde qu'un bloc vide.
    mount({ settings: { activity: { rows: 2 } } });
    expect(sectionOf('activity')?.querySelectorAll('a').length).toBe(3);
  });

  it('montre tout le flux quand le bloc en a la place', () => {
    mount({ settings: { activity: { rows: 6 } } });
    expect(sectionOf('activity')?.querySelectorAll('a').length).toBe(data.activity.length);
  });

  it('montre plus de projets dans une grille plus haute', () => {
    mount({ settings: { projects: { rows: 4 } } });
    // Quatre tuiles tiennent dans quatre rangées ; « Tous les projets », en haut du bloc,
    // mène au reste.
    expect(projectTiles()).toHaveLength(4);
    expect(screen.getByText(t('reviews.filter.allProjects'))).toBeInTheDocument();
  });

  it('montre tous les projets quand la grille est assez haute', () => {
    mount({ settings: { projects: { rows: 6 } } });
    expect(projectTiles()).toHaveLength(data.recentProjects.length);
  });
});

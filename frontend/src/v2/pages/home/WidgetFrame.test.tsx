// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import WidgetFrame, { type WidgetDragHandle } from './WidgetFrame';
import { widgetSettings } from './homeWidgets';

/**
 * Le cadre d'un bloc d'accueil, avant et après le retrait de @dnd-kit du premier
 * chargement (F5).
 *
 * Le cadre appelait `useSortable({ disabled: !editing })`, ce qui embarquait le moteur de
 * glisser-déposer chez tout le monde pour un geste facultatif. Il reçoit maintenant, du seul
 * mode réagencement, ce que le glisser lui donnait. Ce qu'il faut verrouiller, c'est
 * l'équivalence : hors édition, le rendu doit être **exactement** celui que produisait
 * `useSortable` désactivé — ni transform, ni transition, aucune poignée.
 */

const BASE = {
  id: 'myTasks' as const,
  settings: widgetSettings('myTasks', undefined),
  onSettings: () => {},
  onHide: () => {},
  onEdit: () => {},
  onMove: () => {},
  canMoveBefore: true,
  canMoveAfter: true,
};

const sectionOf = () => document.querySelector<HTMLElement>('section[data-widget="myTasks"]');

describe('WidgetFrame', () => {
  it('hors édition, ne porte ni style de déplacement ni poignée', () => {
    render(
      <WidgetFrame {...BASE} editing={false}>
        <p>contenu</p>
      </WidgetFrame>,
    );
    const section = sectionOf();
    expect(section).not.toBeNull();
    // `useSortable` désactivé rendait `transform: undefined, transition: undefined` :
    // autrement dit rien. C'est ce « rien » qu'on vérifie.
    expect(section?.getAttribute('style')).toBeNull();
    expect(screen.queryByRole('button', { name: /d(é|e)placer|drag/i })).not.toBeInTheDocument();
    expect(screen.getByText('contenu')).toBeInTheDocument();
  });

  it('en réagencement, applique ce que le glisser lui donne', () => {
    const drag: WidgetDragHandle = {
      ref: () => {},
      style: { transform: 'translate3d(12px, 0, 0)', transition: 'transform 200ms ease' },
      dragging: true,
      handleProps: { 'aria-roledescription': 'sortable', role: 'button' },
    };
    render(
      <WidgetFrame {...BASE} editing drag={drag}>
        <p>contenu</p>
      </WidgetFrame>,
    );
    const section = sectionOf();
    expect(section?.style.transform).toBe('translate3d(12px, 0, 0)');
    expect(section?.style.transition).toBe('transform 200ms ease');
    // Le bloc en cours de déplacement s'efface, comme avant.
    expect(section?.className).toContain('opacity-60');
    expect(document.querySelector('[aria-roledescription="sortable"]')).not.toBeNull();
  });
});

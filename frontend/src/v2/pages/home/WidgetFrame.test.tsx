// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import WidgetFrame, { type WidgetDragHandle } from './WidgetFrame';
import { widgetSettings } from './homeWidgets';
import type { WidgetSize } from '../../components/widgets/widgetSizing';
import { t } from '../../i18n';

/**
 * Le cadre d'un bloc d'accueil : le retrait de @dnd-kit du premier chargement (F5), puis le
 * redimensionnement (lot 13).
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
  onPreview: () => {},
  onResize: () => {},
};

const sectionOf = () => document.querySelector<HTMLElement>('section[data-widget="myTasks"]');
const handleOf = () => screen.queryByTitle(t('overview.widget.resizeHint'));

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
    // La poignée de taille est une commande de composition : elle vit avec celle du
    // déplacement, et disparaît avec elle.
    expect(handleOf()).toBeNull();
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

  it('porte l’emprise réglée : largeur en colonnes, hauteur en rangées', () => {
    render(
      <WidgetFrame {...BASE} settings={{ ...BASE.settings, span: 8, rows: 5 }} editing={false}>
        <p>contenu</p>
      </WidgetFrame>,
    );
    const section = sectionOf();
    expect(section?.className).toContain('xl:col-span-8');
    expect(section?.className).toContain('row-span-5');
    // Sans cette rangée unique en `1fr`, la hauteur ne descendrait pas jusqu'à la carte et
    // l'emprise réglée ne réserverait qu'un vide sous elle.
    expect(section?.className).toContain('grid-rows-1');
  });

  it('en composition, la poignée règle largeur ET hauteur au clavier', () => {
    const sizes: WidgetSize[] = [];
    render(
      <WidgetFrame
        {...BASE}
        editing
        onResize={(size) => {
          sizes.push(size);
        }}
      >
        <p>contenu</p>
      </WidgetFrame>,
    );
    const handle = handleOf();
    expect(handle).not.toBeNull();
    if (!handle) return;
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    fireEvent.keyDown(handle, { key: 'ArrowDown' });
    // Chaque touche enregistre depuis la taille affichée (6 colonnes, 4 rangées par
    // défaut) : à droite la largeur, en bas la hauteur.
    expect(sizes).toEqual([
      { span: 8, rows: 4 },
      { span: 6, rows: 5 },
    ]);
  });

  it('n’enregistre rien quand la flèche ne change pas la taille', () => {
    const sizes: WidgetSize[] = [];
    render(
      <WidgetFrame
        {...BASE}
        settings={{ ...BASE.settings, span: 12, rows: 6 }}
        editing
        onResize={(size) => {
          sizes.push(size);
        }}
      >
        <p>contenu</p>
      </WidgetFrame>,
    );
    const handle = handleOf();
    if (!handle) return;
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    fireEvent.keyDown(handle, { key: 'ArrowDown' });
    fireEvent.keyDown(handle, { key: 'Enter' });
    expect(sizes).toEqual([]);
  });
});

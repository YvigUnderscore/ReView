// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  ALL_WIDGET_IDS,
  HOME_WIDGETS,
  hiddenWidgets,
  reorderWidgets,
  resetWidgets,
  setWidgetSetting,
  setWidgetSize,
  spanClass,
  toggleWidget,
  visibleWidgets,
  widgetSettings,
  type HomeWidgetsPref,
} from './homeWidgets';
import { WIDGET_ROWS } from '../../components/widgets/widgetSizing';

describe('visibleWidgets', () => {
  it('rend la disposition de déclaration sans préférence', () => {
    expect(visibleWidgets(undefined)).toEqual(ALL_WIDGET_IDS);
  });

  it('respecte l’ordre sauvegardé', () => {
    const pref: HomeWidgetsPref = { order: ['activity', 'stats'] };
    expect(visibleWidgets(pref).slice(0, 2)).toEqual(['activity', 'stats']);
  });

  it('place les blocs livrés après la sauvegarde à leur rang de déclaration', () => {
    const pref: HomeWidgetsPref = { order: ['activity'] };
    const list = visibleWidgets(pref);
    expect(list[0]).toBe('activity');
    // Aucun bloc connu ne disparaît parce qu'il n'était pas dans l'ordre enregistré.
    expect(new Set(list)).toEqual(new Set(ALL_WIDGET_IDS));
  });

  it('écarte les masqués', () => {
    expect(visibleWidgets({ hidden: ['stats'] })).not.toContain('stats');
  });

  it('ignore un identifiant inconnu resté en préférence', () => {
    const pref: HomeWidgetsPref = { order: ['fantome', 'stats'], hidden: ['fantome'] };
    expect(visibleWidgets(pref)).toEqual(expect.arrayContaining(['stats']));
    expect(visibleWidgets(pref)).not.toContain('fantome' as never);
    expect(hiddenWidgets(pref)).toEqual([]);
  });
});

describe('widgetSettings', () => {
  it('applique les défauts du registre', () => {
    const s = widgetSettings('projects', undefined);
    expect(s.span).toBe(HOME_WIDGETS.projects.span);
    expect(s.variant).toBe('grid');
    expect(s.bare).toBe(false);
    expect(s.density).toBe('comfortable');
  });

  it('applique les réglages du compte', () => {
    const pref = setWidgetSetting('projects', { span: 12, bare: true }, undefined);
    const s = widgetSettings('projects', pref);
    expect(s.span).toBe(12);
    expect(s.bare).toBe(true);
  });

  it('refuse une largeur que le bloc ne propose pas', () => {
    const pref: HomeWidgetsPref = { settings: { stats: { span: 3 } } };
    expect(widgetSettings('stats', pref).span).toBe(HOME_WIDGETS.stats.span);
  });

  it('refuse une variante que le bloc ne sait pas rendre', () => {
    const pref: HomeWidgetsPref = { settings: { myTasks: { variant: 'grid' } } };
    expect(widgetSettings('myTasks', pref).variant).toBe('list');
  });

  it('ne touche pas aux réglages des autres blocs', () => {
    const pref = setWidgetSetting('projects', { span: 12 }, { settings: { myTasks: { bare: true } } });
    expect(widgetSettings('myTasks', pref).bare).toBe(true);
    expect(widgetSettings('projects', pref).span).toBe(12);
  });
});

describe('widgetSettings — la hauteur en rangées (lot 13)', () => {
  it('applique la hauteur par défaut du bloc', () => {
    for (const id of ALL_WIDGET_IDS) {
      expect(widgetSettings(id, undefined).rows).toBe(HOME_WIDGETS[id].rows);
      // Une hauteur hors rampe ne produirait aucune classe `row-span-*`.
      expect(WIDGET_ROWS).toContain(HOME_WIDGETS[id].rows);
    }
  });

  it('applique la hauteur enregistrée', () => {
    const pref = setWidgetSize('activity', { span: 8, rows: 6 }, undefined);
    expect(widgetSettings('activity', pref).rows).toBe(6);
  });

  it('relit un accueil composé AVANT les rangées, sans réécrire la préférence', () => {
    // Les dispositions d'avant ce lot ne portent que l'échelle `short`/`normal`/`tall` :
    // elle se traduit à la lecture, pour que personne ne perde le bloc haut qu'il s'était
    // réglé — et la préférence enregistrée, elle, reste telle quelle.
    const before: HomeWidgetsPref = {
      settings: { activity: { height: 'tall' }, myTasks: { height: 'short' }, stats: { span: 8 } },
    };
    expect(widgetSettings('activity', before).rows).toBe(5);
    expect(widgetSettings('myTasks', before).rows).toBe(2);
    // Aucune hauteur enregistrée : le bloc garde son défaut de registre.
    expect(widgetSettings('stats', before).rows).toBe(HOME_WIDGETS.stats.rows);
    expect(before.settings).toEqual({
      activity: { height: 'tall' },
      myTasks: { height: 'short' },
      stats: { span: 8 },
    });
  });

  it('refuse une hauteur hors rampe plutôt que de l’appliquer de travers', () => {
    const pref: HomeWidgetsPref = { settings: { stats: { rows: 9 } } };
    expect(widgetSettings('stats', pref).rows).toBe(HOME_WIDGETS.stats.rows);
  });
});

describe('setWidgetSize', () => {
  it('enregistre largeur et hauteur d’un seul geste', () => {
    // La poignée règle les deux axes ensemble ; un enregistrement par axe doublerait les
    // écritures de préférence.
    const pref = setWidgetSize('myTasks', { span: 12, rows: 5 }, undefined);
    expect(pref.settings?.myTasks).toEqual({ span: 12, rows: 5 });
    const settings = widgetSettings('myTasks', pref);
    expect([settings.span, settings.rows]).toEqual([12, 5]);
  });

  it('conserve les autres réglages du bloc', () => {
    const base = setWidgetSetting('myTasks', { bare: true, density: 'compact' }, undefined);
    const pref = setWidgetSize('myTasks', { span: 8, rows: 2 }, base);
    const settings = widgetSettings('myTasks', pref);
    expect(settings.bare).toBe(true);
    expect(settings.density).toBe('compact');
    expect(settings.rows).toBe(2);
  });
});

describe('reorderWidgets', () => {
  it('déplace un bloc à la place d’un autre', () => {
    const pref = reorderWidgets('activity', 'stats', undefined);
    expect(visibleWidgets(pref)[0]).toBe('activity');
  });

  it('ne change rien quand la cible est la source', () => {
    expect(reorderWidgets('stats', 'stats', undefined)).toEqual({});
  });

  it('conserve les blocs masqués dans l’ordre enregistré', () => {
    // Sans cela, démasquer un bloc le ferait réapparaître à une place arbitraire.
    const pref: HomeWidgetsPref = { hidden: ['activity'] };
    const next = reorderWidgets('myTasks', 'stats', pref);
    expect(next.order).toContain('activity');
  });

  it('ignore un bloc masqué comme cible', () => {
    const pref: HomeWidgetsPref = { hidden: ['activity'] };
    expect(reorderWidgets('stats', 'activity', pref)).toEqual(pref);
  });
});

describe('toggleWidget', () => {
  it('masque puis réaffiche', () => {
    const hiddenPref = toggleWidget('stats', false, undefined);
    expect(hiddenWidgets(hiddenPref)).toEqual(['stats']);
    expect(hiddenWidgets(toggleWidget('stats', true, hiddenPref))).toEqual([]);
  });

  it('préserve l’ordre et les réglages déjà enregistrés', () => {
    // La préférence est fusionnée côté serveur clé par clé : écraser `order` en masquant
    // un bloc effacerait toute la disposition.
    const base: HomeWidgetsPref = { order: ['activity'], settings: { stats: { span: 6 } } };
    const next = toggleWidget('stats', false, base);
    expect(next.order).toEqual(['activity']);
    expect(next.settings).toEqual({ stats: { span: 6 } });
  });
});

describe('resetWidgets', () => {
  it('rend la disposition d’origine', () => {
    const pref = resetWidgets();
    expect(pref.hidden).toEqual([]);
    expect(pref.order).toEqual(ALL_WIDGET_IDS);
    expect(visibleWidgets(pref)).toEqual(ALL_WIDGET_IDS);
  });
});

describe('spanClass', () => {
  it('rend des classes écrites en clair, jamais interpolées', () => {
    // Une classe construite par interpolation est purgée au build et ne produit rien.
    for (const span of [3, 4, 6, 8, 12] as const) {
      expect(spanClass(span)).toMatch(/xl:col-span-\d+/);
      expect(spanClass(span)).not.toContain('${');
    }
  });
});

// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import type { WidgetsPref } from '../../../lib/widgetLayout';
import { OVERVIEW_ROWS } from './overviewSizing';
import {
  ALL_OVERVIEW_IDS,
  BUILTIN_ROLE_LAYOUTS,
  OVERVIEW_WIDGETS,
  OVERVIEW_WIDGET_DEFS,
  addableOverviewWidgets,
  hiddenOverviewWidgets,
  overviewWidgetSettings,
  reorderOverviewWidgets,
  resolveOverviewLayout,
  roleLayout,
  setOverviewWidgetSize,
  toggleOverviewWidget,
  visibleOverviewWidgets,
} from './overviewWidgets';

/**
 * Les règles de la vue d'ensemble composable. Ce qui est vérifié ici n'est pas l'algèbre
 * commune (`lib/widgetLayout`, couverte par `homeWidgets.test`), mais ce que cette page
 * ajoute : le repli sur le défaut du rôle, et le filtre des blocs réservés.
 */

describe('registre', () => {
  it('déclare une définition par identifiant, dans le même ordre', () => {
    expect(ALL_OVERVIEW_IDS).toEqual([...OVERVIEW_WIDGETS]);
  });

  it('ne réserve aux gestionnaires que les blocs dont le serveur refuse la lecture', () => {
    const reserved = ALL_OVERVIEW_IDS.filter((id) => OVERVIEW_WIDGET_DEFS[id].manage);
    expect(reserved).toEqual(['attention', 'retakes']);
  });
});

describe('resolveOverviewLayout', () => {
  const role: WidgetsPref = {
    order: ['activity', 'counts'],
    hidden: ['tasks'],
    settings: { activity: { span: 6 }, counts: { span: 4 } },
  };

  it('sert le défaut du rôle à qui n’a rien personnalisé', () => {
    expect(resolveOverviewLayout(undefined, role)).toEqual(role);
    expect(resolveOverviewLayout(null, role)).toEqual(role);
  });

  it('garde l’ordre du rôle quand la personne n’a fait que masquer', () => {
    // Le repli est par CHAMP : masquer un bloc ne dit rien de l'ordre, et un repli « tout
    // ou rien » ferait perdre l'ordre décidé par l'administration au premier masquage.
    const resolved = resolveOverviewLayout({ hidden: ['activity'] }, role);
    expect(resolved.order).toEqual(['activity', 'counts']);
    expect(resolved.hidden).toEqual(['activity']);
  });

  it('superpose les réglages : ceux du rôle d’abord, ceux de la personne par-dessus', () => {
    const resolved = resolveOverviewLayout({ settings: { activity: { span: 12 } } }, role);
    expect(resolved.settings).toEqual({ activity: { span: 12 }, counts: { span: 4 } });
  });

  it('sans rôle ni personne, ne rend rien à masquer ni à ordonner', () => {
    expect(resolveOverviewLayout(undefined, undefined)).toEqual({});
  });
});

describe('roleLayout', () => {
  it('préfère le défaut réglé par l’administration', () => {
    const studio = { ARTIST: { hidden: ['activity'] } };
    expect(roleLayout(studio, 'ARTIST')).toEqual(studio.ARTIST);
  });

  it('retombe sur la disposition livrée avec le produit', () => {
    expect(roleLayout({}, 'SUPERVISOR')).toEqual(BUILTIN_ROLE_LAYOUTS.SUPERVISOR);
    expect(roleLayout(undefined, 'CLIENT')).toEqual(BUILTIN_ROLE_LAYOUTS.CLIENT);
  });

  it('traite un rôle inconnu comme le plus restreint des rôles internes', () => {
    expect(roleLayout(undefined, null)).toEqual(BUILTIN_ROLE_LAYOUTS.ARTIST);
  });

  it('donne à chaque rôle une page qui lui parle', () => {
    // Un artiste entre par son travail, un superviseur par ce qui bloque, un client par
    // ce qu'il y a à regarder. C'est la promesse du défaut par rôle ; sans elle, la
    // fonctionnalité se réduit à « chacun refera sa page ».
    expect(visibleOverviewWidgets(BUILTIN_ROLE_LAYOUTS.ARTIST, false)[0]).toBe('myTasks');
    expect(visibleOverviewWidgets(BUILTIN_ROLE_LAYOUTS.SUPERVISOR, true)[0]).toBe('attention');
    expect(visibleOverviewWidgets(BUILTIN_ROLE_LAYOUTS.CLIENT, false)).toEqual(['latestMedia', 'activity']);
  });
});

describe('visibleOverviewWidgets', () => {
  it('rend l’ordre de déclaration sans disposition', () => {
    expect(visibleOverviewWidgets(undefined, true)).toEqual([...OVERVIEW_WIDGETS]);
  });

  it('écarte les blocs masqués', () => {
    expect(visibleOverviewWidgets({ hidden: ['counts'] }, true)).not.toContain('counts');
  });

  it('écarte les blocs réservés pour qui ne gère pas le projet', () => {
    const visible = visibleOverviewWidgets(undefined, false);
    expect(visible).not.toContain('attention');
    expect(visible).not.toContain('retakes');
    expect(visible).toContain('activity');
  });

  it('ignore un identifiant inconnu resté en disposition', () => {
    const pref: WidgetsPref = { order: ['fantome', 'counts'], hidden: ['fantome'] };
    expect(visibleOverviewWidgets(pref, true)).toEqual(expect.arrayContaining(['counts']));
    expect(hiddenOverviewWidgets(pref)).toEqual([]);
  });
});

describe('addableOverviewWidgets', () => {
  it('ne propose jamais d’ajouter un bloc dont le serveur refuserait le contenu', () => {
    const hiddenAll: WidgetsPref = { hidden: ['attention', 'retakes', 'counts'] };
    expect(addableOverviewWidgets(hiddenAll, false)).toEqual(['counts']);
    // Le catalogue suit l'ordre où les blocs ont été retirés, pas celui du registre.
    expect(addableOverviewWidgets(hiddenAll, true)).toEqual(['attention', 'retakes', 'counts']);
  });
});

describe('gestes de composition', () => {
  it('masque puis réaffiche sans perdre l’ordre du rôle', () => {
    const base = resolveOverviewLayout(undefined, BUILTIN_ROLE_LAYOUTS.ARTIST);
    const hidden = toggleOverviewWidget('activity', false, base);
    expect(visibleOverviewWidgets(hidden, false)).not.toContain('activity');
    expect(hidden.order).toEqual(base.order);
    expect(visibleOverviewWidgets(toggleOverviewWidget('activity', true, hidden), false)).toContain(
      'activity',
    );
  });

  it('réordonne en conservant les masqués dans l’ordre enregistré', () => {
    const next = reorderOverviewWidgets('activity', 'counts', { hidden: ['tasks'] });
    expect(next.order?.[0]).toBe('activity');
    expect(next.order).toContain('tasks');
  });

  it('applique les réglages de la disposition, sinon ceux du registre', () => {
    expect(overviewWidgetSettings('activity', { settings: { activity: { span: 12 } } }).span).toBe(12);
    expect(overviewWidgetSettings('activity', undefined).span).toBe(OVERVIEW_WIDGET_DEFS.activity.span);
    // Une largeur que le bloc ne propose pas est refusée, pas appliquée de travers.
    expect(overviewWidgetSettings('counts', { settings: { counts: { span: 3 } } }).span).toBe(
      OVERVIEW_WIDGET_DEFS.counts.span,
    );
  });

  it('enregistre largeur et hauteur d’un seul geste', () => {
    const next = setOverviewWidgetSize(
      'activity',
      { span: 12, rows: 6 },
      { settings: { activity: { span: 4 } } },
    );
    expect(next.settings?.activity).toEqual({ span: 12, rows: 6 });
  });
});

describe('hauteurs', () => {
  it('donne à chaque bloc une hauteur par défaut', () => {
    for (const id of ALL_OVERVIEW_IDS)
      expect(OVERVIEW_ROWS).toContain(overviewWidgetSettings(id, undefined).rows);
  });

  it('applique la hauteur enregistrée', () => {
    expect(overviewWidgetSettings('activity', { settings: { activity: { rows: 6 } } }).rows).toBe(6);
  });

  it('relit sans casse une disposition enregistrée avant les hauteurs', () => {
    // Ni hauteur ni rangées : le bloc reprend son défaut, et rien n'est réécrit.
    expect(overviewWidgetSettings('counts', { settings: { counts: { span: 6 } } }).rows).toBe(
      OVERVIEW_WIDGET_DEFS.counts.rows,
    );
    // L'ancienne échelle, elle, est traduite — on ne perd pas le bloc haut qu'on s'était réglé.
    expect(overviewWidgetSettings('activity', { settings: { activity: { height: 'tall' } } }).rows).toBe(5);
  });

  it('porte les hauteurs jusque dans les dispositions livrées par rôle', () => {
    // Le défaut par rôle du lot 10 doit continuer de fonctionner ET dire une hauteur :
    // sinon la page d'un artiste rouvrirait sur les cartes courtes qu'on vient de corriger.
    const artist = resolveOverviewLayout(undefined, BUILTIN_ROLE_LAYOUTS.ARTIST);
    expect(overviewWidgetSettings('myTasks', artist).rows).toBe(5);
    expect(overviewWidgetSettings('activity', artist).rows).toBe(5);
    const client = resolveOverviewLayout(undefined, BUILTIN_ROLE_LAYOUTS.CLIENT);
    expect(overviewWidgetSettings('latestMedia', client).rows).toBe(4);
  });
});

// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  OVERVIEW_PREFERENCE_KEY,
  OVERVIEW_ROWS,
  OVERVIEW_WIDGETS,
  overviewLayoutSchema,
} from './overviewWidgets';

/**
 * Le registre vit en deux copies (un paquet ne peut pas importer les sources de l'autre).
 * Ce test est le seul garde-fou : une copie amendée sans l'autre donnerait un écran qui
 * propose un bloc que le serveur refuse d'enregistrer, ou l'inverse — et le refus tombe
 * sur la personne qui compose sa page, au moment où elle la compose.
 */
const FRONT = path.join(__dirname, '..', '..', '..', 'frontend', 'src', 'v2');
const FRONT_COPY = path.join(FRONT, 'pages', 'project', 'overview', 'overviewWidgets.ts');
const FRONT_SIZING = path.join(FRONT, 'pages', 'project', 'overview', 'overviewSizing.ts');

/** Les identifiants du tableau `NOM = [ … ] as const` d'une source TypeScript. */
function listedIn(source: string, name: string): string[] {
  const open = source.indexOf(`export const ${name} = [`);
  if (open < 0) return [];
  const close = source.indexOf('] as const;', open);
  if (close < 0) return [];
  return [...source.slice(open, close).matchAll(/'([^']+)'/g)].map((m) => m[1]!);
}

/** Les nombres du tableau `NOM = [ … ] as const` d'une source TypeScript. */
function numbersIn(source: string, name: string): number[] {
  const open = source.indexOf(`export const ${name} = [`);
  if (open < 0) return [];
  const close = source.indexOf('] as const;', open);
  if (close < 0) return [];
  return [...source.slice(open, close).matchAll(/\d+/g)].map((m) => Number(m[0]));
}

describe('registre des blocs de la vue d’ensemble', () => {
  const front = readFileSync(FRONT_COPY, 'utf8');

  it('liste les mêmes blocs, dans le même ordre, des deux côtés', () => {
    expect(listedIn(front, 'OVERVIEW_WIDGETS')).toEqual([...OVERVIEW_WIDGETS]);
  });

  it('nomme la même clé de préférence des deux côtés', () => {
    expect(front).toContain(`OVERVIEW_PREFERENCE_KEY = '${OVERVIEW_PREFERENCE_KEY}'`);
  });

  it('offre la même rampe de hauteurs des deux côtés', () => {
    // Même garde-fou que pour les blocs : une rampe élargie côté écran sans l'être ici, et
    // le redimensionnement se solderait par un refus, la poignée à la main.
    expect(numbersIn(readFileSync(FRONT_SIZING, 'utf8'), 'OVERVIEW_ROWS')).toEqual([...OVERVIEW_ROWS]);
  });
});

describe('overviewLayoutSchema', () => {
  const accepts = (value: unknown) => overviewLayoutSchema.safeParse(value).success;

  it('accepte une disposition réelle', () => {
    expect(
      accepts({
        hidden: ['counts'],
        order: ['activity', 'myTasks', 'counts'],
        settings: { activity: { span: 6, height: 'short', density: 'compact', bare: true } },
      }),
    ).toBe(true);
  });

  it('accepte une disposition vide — c’est ce qu’écrit une page jamais composée', () => {
    expect(accepts({})).toBe(true);
  });

  it('refuse un bloc inconnu, où qu’il se cache', () => {
    // C'est le défaut que le schéma existe pour empêcher : un identifiant inventé
    // s'enregistrait sans broncher et n'affichait rien.
    expect(accepts({ order: ['fantome'] })).toBe(false);
    expect(accepts({ hidden: ['fantome'] })).toBe(false);
    expect(accepts({ settings: { fantome: { span: 6 } } })).toBe(false);
  });

  it('refuse un même bloc deux fois dans une liste', () => {
    expect(accepts({ order: ['counts', 'counts'] })).toBe(false);
  });

  it('refuse une largeur hors rampe et un réglage inventé', () => {
    expect(accepts({ settings: { counts: { span: 5 } } })).toBe(false);
    expect(accepts({ settings: { counts: { couleur: 'rouge' } } })).toBe(false);
  });

  it('refuse une clé de disposition inventée', () => {
    expect(accepts({ columns: 3 })).toBe(false);
  });

  it('accepte une hauteur en rangées, et refuse une hauteur hors rampe', () => {
    expect(accepts({ settings: { counts: { span: 6, rows: 4 } } })).toBe(true);
    expect(accepts({ settings: { counts: { rows: 7 } } })).toBe(false);
    expect(accepts({ settings: { counts: { rows: 1 } } })).toBe(false);
  });

  it('accepte encore l’ancienne échelle de hauteur', () => {
    // Les dispositions enregistrées avant les rangées la portent, et l'écran la traduit à
    // la lecture. La refuser rendrait illisible la page de tout un studio.
    expect(accepts({ settings: { counts: { height: 'tall' } } })).toBe(true);
  });
});

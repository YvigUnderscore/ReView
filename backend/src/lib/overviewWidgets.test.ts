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
 * The registry lives in two copies (one package cannot import the sources of the other). This test is the only guard:
 * a copy amended without the other would give a screen offering a block the server refuses to save, or the reverse — and
 * the refusal lands on the person composing their page, at the moment they compose it.
 */
const FRONT = path.join(__dirname, '..', '..', '..', 'frontend', 'src', 'v2');
const FRONT_COPY = path.join(FRONT, 'pages', 'project', 'overview', 'overviewWidgets.ts');
// The overview uses the shared widget sizing model since the frontend dropped its own copy.
const FRONT_SIZING = path.join(FRONT, 'components', 'widgets', 'widgetSizing.ts');

/** The identifiers of the `NAME = [ … ] as const` array of a TypeScript source. */
function listedIn(source: string, name: string): string[] {
  const open = source.indexOf(`export const ${name} = [`);
  if (open < 0) return [];
  const close = source.indexOf('] as const;', open);
  if (close < 0) return [];
  return [...source.slice(open, close).matchAll(/'([^']+)'/g)].map((m) => m[1]!);
}

/** The numbers of the `NAME = [ … ] as const` array of a TypeScript source. */
function numbersIn(source: string, name: string): number[] {
  const open = source.indexOf(`export const ${name} = [`);
  if (open < 0) return [];
  const close = source.indexOf('] as const;', open);
  if (close < 0) return [];
  return [...source.slice(open, close).matchAll(/\d+/g)].map((m) => Number(m[0]));
}

describe('registry of the overview blocks', () => {
  const front = readFileSync(FRONT_COPY, 'utf8');

  it('lists the same blocks, in the same order, on both sides', () => {
    expect(listedIn(front, 'OVERVIEW_WIDGETS')).toEqual([...OVERVIEW_WIDGETS]);
  });

  it('names the same preference key on both sides', () => {
    expect(front).toContain(`OVERVIEW_PREFERENCE_KEY = '${OVERVIEW_PREFERENCE_KEY}'`);
  });

  it('offers the same height ramp on both sides', () => {
    // Same guard as for the blocks: a ramp widened on the screen side but not here, and resizing would end in a refusal,
    // the handle in hand.
    expect(numbersIn(readFileSync(FRONT_SIZING, 'utf8'), 'WIDGET_ROWS')).toEqual([...OVERVIEW_ROWS]);
  });
});

describe('overviewLayoutSchema', () => {
  const accepts = (value: unknown) => overviewLayoutSchema.safeParse(value).success;

  it('accepts a real layout', () => {
    expect(
      accepts({
        hidden: ['counts'],
        order: ['activity', 'myTasks', 'counts'],
        settings: { activity: { span: 6, height: 'short', density: 'compact', bare: true } },
      }),
    ).toBe(true);
  });

  it('accepts an empty layout — which is what a never-composed page writes', () => {
    expect(accepts({})).toBe(true);
  });

  it('refuses an unknown block, wherever it hides', () => {
    // This is the defect the schema exists to prevent: an invented identifier would be saved without a murmur and display nothing.
    expect(accepts({ order: ['fantome'] })).toBe(false);
    expect(accepts({ hidden: ['fantome'] })).toBe(false);
    expect(accepts({ settings: { fantome: { span: 6 } } })).toBe(false);
  });

  it('refuses the same block twice in a list', () => {
    expect(accepts({ order: ['counts', 'counts'] })).toBe(false);
  });

  it('refuses a width off the ramp and an invented setting', () => {
    expect(accepts({ settings: { counts: { span: 5 } } })).toBe(false);
    expect(accepts({ settings: { counts: { couleur: 'rouge' } } })).toBe(false);
  });

  it('refuses an invented layout key', () => {
    expect(accepts({ columns: 3 })).toBe(false);
  });

  it('accepts a height in rows, and refuses a height off the ramp', () => {
    expect(accepts({ settings: { counts: { span: 6, rows: 4 } } })).toBe(true);
    expect(accepts({ settings: { counts: { rows: 7 } } })).toBe(false);
    expect(accepts({ settings: { counts: { rows: 1 } } })).toBe(false);
  });

  it('still accepts the former height scale', () => {
    // Layouts saved before the rows carry it, and the screen translates it on read. Refusing it would make the page of
    // a whole studio unreadable.
    expect(accepts({ settings: { counts: { height: 'tall' } } })).toBe(true);
  });
});

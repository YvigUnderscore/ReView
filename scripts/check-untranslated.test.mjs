// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { isAllowed, isIdentifierLike, isUtilityClasses, scan } from './check-untranslated.mjs';

/** Fichier .tsx jetable : `scan` lit sur disque, pas en mémoire. */
const dir = mkdtempSync(join(tmpdir(), 'review-untranslated-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const scanSource = (source, name = 'Sample.tsx') => {
  const file = join(dir, name);
  writeFileSync(file, source, 'utf8');
  return scan(file);
};

describe('isAllowed', () => {
  it('laisse passer les sigles et unités du vocabulaire admis', () => {
    expect(isAllowed('API')).toBe(true);
    expect(isAllowed('1920 px')).toBe(true);
    expect(isAllowed('dailies')).toBe(true);
  });

  it('refuse de la prose ordinaire', () => {
    expect(isAllowed('Supprimer le projet')).toBe(false);
    expect(isAllowed('Delete project')).toBe(false);
  });

  it('laisse passer un texte sans aucune lettre', () => {
    expect(isAllowed('— 12 : 34 %')).toBe(true);
  });
});

describe('isUtilityClasses', () => {
  it('reconnaît une pile de classes Tailwind', () => {
    expect(isUtilityClasses('flex items-center gap-2')).toBe(true);
  });

  it('ne prend pas une phrase pour des classes', () => {
    expect(isUtilityClasses('Ajouter un plan')).toBe(false);
  });

  it('exige au moins un mot composé — deux mots nus ne sont pas des classes', () => {
    expect(isUtilityClasses('flex block')).toBe(false);
  });
});

describe('isIdentifierLike', () => {
  it('écarte les identifiants, chemins et clés', () => {
    for (const text of ['task-status', 'camelCase', 'SCREAMING_SNAKE', '/api/projects', 'review:tree:']) {
      expect(isIdentifierLike(text), text).toBe(true);
    }
  });

  it('ne prend pas de la prose pour un identifiant', () => {
    expect(isIdentifierLike('Ajouter un plan')).toBe(false);
  });
});

describe('scan', () => {
  it('relève le texte JSX écrit en dur', () => {
    expect(scanSource('export const A = () => <p>Ajouter un plan</p>;')).toContain('Ajouter un plan');
  });

  it('relève une prop visible écrite en dur', () => {
    expect(scanSource('export const A = () => <input placeholder="Nom du projet" />;')).toContain(
      'Nom du projet',
    );
  });

  it('relève une phrase assemblée autour d’une interpolation', () => {
    const found = scanSource('export const A = (n: number) => <p>{`${n} fichiers supprimés`}</p>;');
    expect(found.join(' ')).toMatch(/fichiers supprim/);
  });

  it('laisse passer le texte traduit par t()', () => {
    expect(scanSource('export const A = ({ t }) => <p>{t("shots.add")}</p>;')).toEqual([]);
  });

  it('laisse passer un littéral technique placé dans <code>', () => {
    expect(scanSource('export const A = () => <code>docker compose up -d</code>;')).toEqual([]);
  });

  it('laisse passer une classe CSS et une URL', () => {
    expect(
      scanSource('export const A = () => <a className="flex items-center" href="/api/docs" />;'),
    ).toEqual([]);
  });
});

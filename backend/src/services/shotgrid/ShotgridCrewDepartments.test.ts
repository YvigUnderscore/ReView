// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../lib/prisma', () => ({ prisma: {} }));
const { findByKey } = vi.hoisted(() => ({ findByKey: vi.fn() }));
vi.mock('../DepartmentService', () => ({ findByKey }));

import {
  DEPARTMENT_FIELDS,
  departmentFields,
  departmentLabel,
  matchDepartments,
} from './ShotgridCrewDepartments';
import type { ShotgridClient } from './ShotgridClient';

/** Client réduit au seul appel que ce module fait. */
const client = (schema: () => Promise<Set<string>>) =>
  ({ schemaFields: vi.fn(schema) }) as unknown as ShotgridClient;

describe('departmentFields', () => {
  it('ne retient que les champs que le site déclare', async () => {
    // Demander un champ inconnu ne renvoie pas « vide » : la requête ENTIÈRE échoue, et
    // l'équipe ne se charge plus du tout. D'où la sonde préalable.
    const sg = client(() => Promise.resolve(new Set(['login', 'name', 'sg_department'])));
    expect(await departmentFields(sg)).toEqual(['sg_department']);
  });

  it('rend une liste vide quand aucun des deux noms n’existe', async () => {
    const sg = client(() => Promise.resolve(new Set(['login', 'name', 'email'])));
    expect(await departmentFields(sg)).toEqual([]);
  });

  it('rend les deux champs quand le site porte les deux', async () => {
    const sg = client(() => Promise.resolve(new Set(DEPARTMENT_FIELDS)));
    expect(await departmentFields(sg)).toEqual(['department', 'sg_department']);
  });

  it('avale un schéma illisible plutôt que de faire tomber la passe', async () => {
    // Un script sans droit sur le schéma répond 403 : c'est un confort, pas une panne.
    const sg = client(() => Promise.reject(new Error('403')));
    await expect(departmentFields(sg)).resolves.toEqual([]);
  });
});

describe('departmentLabel', () => {
  const fields = ['department', 'sg_department'];

  it('lit un lien d’entité, la forme standard', () => {
    const record = {
      id: 1,
      type: 'HumanUser',
      department: { id: 9, type: 'Department', name: 'Compositing' },
    };
    expect(departmentLabel(record, fields)).toBe('Compositing');
  });

  it('lit le premier nommé d’une liste de liens', () => {
    const record = {
      id: 1,
      type: 'HumanUser',
      department: [
        { id: 9, type: 'Department' },
        { id: 10, type: 'Department', name: 'Lighting' },
      ],
    };
    expect(departmentLabel(record, fields)).toBe('Lighting');
  });

  it('accepte un champ maison en texte simple', () => {
    expect(departmentLabel({ id: 1, type: 'HumanUser', sg_department: 'Roto' }, fields)).toBe('Roto');
  });

  it('préfère le champ standard quand les deux sont renseignés', () => {
    const record = {
      id: 1,
      type: 'HumanUser',
      department: { id: 9, type: 'Department', name: 'FX' },
      sg_department: 'Autre',
    };
    expect(departmentLabel(record, fields)).toBe('FX');
  });

  it('rend null sans champ demandé — le site n’en déclare aucun', () => {
    expect(
      departmentLabel(
        { id: 1, type: 'HumanUser', department: { id: 9, type: 'Department', name: 'FX' } },
        [],
      ),
    ).toBeNull();
  });

  it('rend null sur une valeur vide ou absente', () => {
    expect(departmentLabel({ id: 1, type: 'HumanUser', sg_department: '   ' }, fields)).toBeNull();
    expect(departmentLabel({ id: 1, type: 'HumanUser' }, fields)).toBeNull();
  });
});

describe('matchDepartments', () => {
  it('ne cherche qu’une fois par libellé distinct et ne crée rien', async () => {
    // Une équipe de soixante personnes tient en cinq départements : autant d'allers-retours
    // que de personnes serait du gaspillage. Et `findByKey` ne crée pas — un département
    // ShotGrid est une unité d'organisation, pas forcément une étape du pipe.
    findByKey.mockReset();
    findByKey.mockImplementation((_projectId: number, key: string) =>
      Promise.resolve(key === 'Compositing' ? { id: 3, name: 'Compositing' } : null),
    );
    const found = await matchDepartments(7, ['Compositing', 'Compositing', 'Cuisine', null]);
    expect(findByKey).toHaveBeenCalledTimes(2);
    expect(found.get('Compositing')).toMatchObject({ id: 3 });
    expect(found.has('Cuisine')).toBe(false);
  });
});

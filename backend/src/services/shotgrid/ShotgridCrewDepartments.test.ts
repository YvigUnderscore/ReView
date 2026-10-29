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

/** Client reduced to the only call this module makes. */
const client = (schema: () => Promise<Set<string>>) =>
  ({ schemaFields: vi.fn(schema) }) as unknown as ShotgridClient;

describe('departmentFields', () => {
  it('keeps only the fields the site declares', async () => {
    // Requesting an unknown field does not return "empty": the WHOLE request fails, and the
    // team is no longer loaded at all. Hence the preliminary probe.
    const sg = client(() => Promise.resolve(new Set(['login', 'name', 'sg_department'])));
    expect(await departmentFields(sg)).toEqual(['sg_department']);
  });

  it('returns an empty list when neither name exists', async () => {
    const sg = client(() => Promise.resolve(new Set(['login', 'name', 'email'])));
    expect(await departmentFields(sg)).toEqual([]);
  });

  it('returns both fields when the site has both', async () => {
    const sg = client(() => Promise.resolve(new Set(DEPARTMENT_FIELDS)));
    expect(await departmentFields(sg)).toEqual(['department', 'sg_department']);
  });

  it('swallows an unreadable schema rather than failing the pass', async () => {
    // A script without rights on the schema gets a 403: that is a convenience, not an outage.
    const sg = client(() => Promise.reject(new Error('403')));
    await expect(departmentFields(sg)).resolves.toEqual([]);
  });
});

describe('departmentLabel', () => {
  const fields = ['department', 'sg_department'];

  it('reads an entity link, the standard form', () => {
    const record = {
      id: 1,
      type: 'HumanUser',
      department: { id: 9, type: 'Department', name: 'Compositing' },
    };
    expect(departmentLabel(record, fields)).toBe('Compositing');
  });

  it('reads the first named entry of a list of links', () => {
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

  it('accepts a custom field as plain text', () => {
    expect(departmentLabel({ id: 1, type: 'HumanUser', sg_department: 'Roto' }, fields)).toBe('Roto');
  });

  it('prefers the standard field when both are filled in', () => {
    const record = {
      id: 1,
      type: 'HumanUser',
      department: { id: 9, type: 'Department', name: 'FX' },
      sg_department: 'Autre',
    };
    expect(departmentLabel(record, fields)).toBe('FX');
  });

  it('returns null without a requested field: the site declares none', () => {
    expect(
      departmentLabel(
        { id: 1, type: 'HumanUser', department: { id: 9, type: 'Department', name: 'FX' } },
        [],
      ),
    ).toBeNull();
  });

  it('returns null on an empty or absent value', () => {
    expect(departmentLabel({ id: 1, type: 'HumanUser', sg_department: '   ' }, fields)).toBeNull();
    expect(departmentLabel({ id: 1, type: 'HumanUser' }, fields)).toBeNull();
  });
});

describe('matchDepartments', () => {
  it('looks up only once per distinct label and creates nothing', async () => {
    // A team of sixty people fits in five departments: as many round trips as people would be wasteful.
    // And `findByKey` does not create: a ShotGrid department is an organizational unit, not necessarily a step of the pipe.
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

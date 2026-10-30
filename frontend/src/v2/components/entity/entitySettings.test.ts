// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import {
  departmentsChanged,
  formError,
  formFromEntity,
  payloadFromForm,
  type EntityFormValues,
} from './entitySettings';

const base = (over: Partial<EntityFormValues> = {}): EntityFormValues => ({
  name: 'Rooftop chase',
  code: 'SQ010',
  typeLabel: '',
  description: '',
  startFrame: '',
  endFrame: '',
  pipelineStatusId: null,
  departmentIds: [],
  ...over,
});

describe('formFromEntity', () => {
  it('fills the form from the entity, absent fields included', () => {
    expect(formFromEntity({ name: 'Ship', typeLabel: 'Mecha' })).toEqual(
      base({
        name: 'Ship',
        code: '',
        typeLabel: 'Mecha',
      }),
    );
  });

  it('renders frames as text so that an empty field stays empty', () => {
    const form = formFromEntity({ name: 'SH010', startFrame: 1001, endFrame: null });
    expect(form.startFrame).toBe('1001');
    expect(form.endFrame).toBe('');
  });

  it('maps the departments by identifier', () => {
    expect(formFromEntity({ departments: [{ id: 3 }, { id: 7 }] }).departmentIds).toEqual([3, 7]);
  });
});

describe('payloadFromForm', () => {
  it('sends nothing when nothing has changed', () => {
    const form = base();
    expect(payloadFromForm('sequence', form, form)).toEqual({});
  });

  it('sends only the modified field', () => {
    expect(payloadFromForm('sequence', base(), base({ name: 'Rooftop' }))).toEqual({ name: 'Rooftop' });
  });

  it('ignores a field the entity does not have', () => {
    // An asset has neither a code nor a frame range: proposing them would be a server error.
    const changed = base({ code: 'AUTRE', startFrame: '12', typeLabel: 'Mecha' });
    expect(payloadFromForm('asset', base(), changed)).toEqual({ typeLabel: 'Mecha' });
  });

  it('empties a description rather than sending a blank string', () => {
    const initial = base({ description: 'ancienne' });
    expect(payloadFromForm('shot', initial, base({ description: '   ' }))).toEqual({ description: null });
  });

  it('converts the frames and treats an unreadable entry as an empty field', () => {
    expect(payloadFromForm('shot', base(), base({ startFrame: '1001' }))).toEqual({ startFrame: 1001 });
    expect(payloadFromForm('shot', base(), base({ startFrame: 'abc' }))).toEqual({ startFrame: null });
  });

  it('sends the clearing of a status, which is not "no change"', () => {
    const initial = base({ pipelineStatusId: 4 });
    expect(payloadFromForm('shot', initial, base({ pipelineStatusId: null }))).toEqual({
      pipelineStatusId: null,
    });
  });

  it('leaves the departments to their own route', () => {
    expect(payloadFromForm('shot', base(), base({ departmentIds: [1] }))).toEqual({});
  });
});

describe('departmentsChanged', () => {
  it('ignores order', () => {
    expect(departmentsChanged(base({ departmentIds: [1, 2] }), base({ departmentIds: [2, 1] }))).toBe(false);
  });

  it('detects an addition, a removal and a replacement', () => {
    expect(departmentsChanged(base({ departmentIds: [1] }), base({ departmentIds: [1, 2] }))).toBe(true);
    expect(departmentsChanged(base({ departmentIds: [1, 2] }), base({ departmentIds: [1] }))).toBe(true);
    expect(departmentsChanged(base({ departmentIds: [1] }), base({ departmentIds: [2] }))).toBe(true);
  });
});

describe('formError', () => {
  it('requires a name for every entity', () => {
    expect(formError('asset', base({ name: '  ' }))).toBe('name');
  });

  it('requires a code where one exists, and nowhere else', () => {
    expect(formError('shot', base({ code: '' }))).toBe('code');
    expect(formError('asset', base({ code: '' }))).toBeNull();
  });

  it('lets a complete form through', () => {
    expect(formError('sequence', base())).toBeNull();
  });
});

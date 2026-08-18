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
  it('remplit le formulaire depuis l’entité, champs absents compris', () => {
    expect(formFromEntity({ name: 'Ship', typeLabel: 'Mecha' })).toEqual(
      base({
        name: 'Ship',
        code: '',
        typeLabel: 'Mecha',
      }),
    );
  });

  it('rend les frames en texte pour que le champ vide reste vide', () => {
    const form = formFromEntity({ name: 'SH010', startFrame: 1001, endFrame: null });
    expect(form.startFrame).toBe('1001');
    expect(form.endFrame).toBe('');
  });

  it('remonte les départements par identifiant', () => {
    expect(formFromEntity({ departments: [{ id: 3 }, { id: 7 }] }).departmentIds).toEqual([3, 7]);
  });
});

describe('payloadFromForm', () => {
  it('n’envoie rien quand rien n’a changé', () => {
    const form = base();
    expect(payloadFromForm('sequence', form, form)).toEqual({});
  });

  it('n’envoie que le champ modifié', () => {
    expect(payloadFromForm('sequence', base(), base({ name: 'Rooftop' }))).toEqual({ name: 'Rooftop' });
  });

  it('ignore un champ que l’entité ne possède pas', () => {
    // Un asset n'a ni code ni plage de frames : les proposer serait une erreur du serveur.
    const changed = base({ code: 'AUTRE', startFrame: '12', typeLabel: 'Mecha' });
    expect(payloadFromForm('asset', base(), changed)).toEqual({ typeLabel: 'Mecha' });
  });

  it('vide une description plutôt que d’envoyer une chaîne blanche', () => {
    const initial = base({ description: 'ancienne' });
    expect(payloadFromForm('shot', initial, base({ description: '   ' }))).toEqual({ description: null });
  });

  it('convertit les frames et traite une saisie illisible comme un champ vide', () => {
    expect(payloadFromForm('shot', base(), base({ startFrame: '1001' }))).toEqual({ startFrame: 1001 });
    expect(payloadFromForm('shot', base(), base({ startFrame: 'abc' }))).toEqual({ startFrame: null });
  });

  it('transmet l’effacement d’un statut, qui n’est pas « aucun changement »', () => {
    const initial = base({ pipelineStatusId: 4 });
    expect(payloadFromForm('shot', initial, base({ pipelineStatusId: null }))).toEqual({
      pipelineStatusId: null,
    });
  });

  it('laisse les départements à leur propre route', () => {
    expect(payloadFromForm('shot', base(), base({ departmentIds: [1] }))).toEqual({});
  });
});

describe('departmentsChanged', () => {
  it('ignore l’ordre', () => {
    expect(departmentsChanged(base({ departmentIds: [1, 2] }), base({ departmentIds: [2, 1] }))).toBe(false);
  });

  it('voit un ajout, un retrait et un remplacement', () => {
    expect(departmentsChanged(base({ departmentIds: [1] }), base({ departmentIds: [1, 2] }))).toBe(true);
    expect(departmentsChanged(base({ departmentIds: [1, 2] }), base({ departmentIds: [1] }))).toBe(true);
    expect(departmentsChanged(base({ departmentIds: [1] }), base({ departmentIds: [2] }))).toBe(true);
  });
});

describe('formError', () => {
  it('exige un nom pour toute entité', () => {
    expect(formError('asset', base({ name: '  ' }))).toBe('name');
  });

  it('exige un code là où il en existe un, et nulle part ailleurs', () => {
    expect(formError('shot', base({ code: '' }))).toBe('code');
    expect(formError('asset', base({ code: '' }))).toBeNull();
  });

  it('laisse passer un formulaire complet', () => {
    expect(formError('sequence', base())).toBeNull();
  });
});

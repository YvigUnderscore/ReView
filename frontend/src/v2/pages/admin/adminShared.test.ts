// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { auditActionLabel, parseSizeToBytes, bytesToUnit, fmtDateTime } from './adminShared';

describe('adminShared — fmtDateTime', () => {
  it('formate une date ISO en fr-FR avec année et heure', () => {
    const out = fmtDateTime('2026-08-02T10:30:00Z');
    expect(out).toContain('2026');
    expect(out).toMatch(/\d{2}:\d{2}/);
  });
});

describe('adminShared — tailles MB/GB (Phase 21)', () => {
  it('parseSizeToBytes convertit GB et MB en base 1024, comme formatBytes', () => {
    expect(parseSizeToBytes('5', 'GB')).toBe(5 * 1024 ** 3);
    expect(parseSizeToBytes('500', 'MB')).toBe(500 * 1024 ** 2);
  });

  it('parseSizeToBytes accepte la virgule décimale', () => {
    expect(parseSizeToBytes('5,5', 'GB')).toBe(Math.round(5.5 * 1024 ** 3));
    expect(parseSizeToBytes('1.25', 'GB')).toBe(Math.round(1.25 * 1024 ** 3));
  });

  it('parseSizeToBytes rejette les valeurs invalides', () => {
    expect(parseSizeToBytes('abc', 'GB')).toBeNull();
    expect(parseSizeToBytes('-1', 'GB')).toBeNull();
    expect(parseSizeToBytes('', 'MB')).toBeNull();
  });

  it('bytesToUnit choisit GB dès 1 Gio, sinon MB', () => {
    expect(bytesToUnit(5 * 1024 ** 3)).toEqual({ value: '5', unit: 'GB' });
    expect(bytesToUnit(500 * 1024 ** 2)).toEqual({ value: '500', unit: 'MB' });
    expect(bytesToUnit(1024 ** 3 - 1)).toMatchObject({ unit: 'MB' });
  });

  it('round-trip exact pour une valeur ronde', () => {
    const { value, unit } = bytesToUnit(5 * 1024 ** 3);
    expect(parseSizeToBytes(value, unit)).toBe(5 * 1024 ** 3);
  });

  // Le sélecteur d'unité et l'affichage doivent compter dans la même base : saisir « 1 GB »
  // puis relire la valeur ne doit pas faire apparaître 0,93.
  it('parseSizeToBytes et bytesToUnit partagent la base de formatBytes', () => {
    const bytes = parseSizeToBytes('2', 'GB');
    expect(bytes).toBe(2 * 1024 ** 3);
    expect(bytesToUnit(bytes!)).toEqual({ value: '2', unit: 'GB' });
  });
});

describe('auditActionLabel', () => {
  // `t` d'essai : rend la clé, ce qui suffit à vérifier QUI est appelé et combien de fois.
  const t = ((key: string) => key) as unknown as Parameters<typeof auditActionLabel>[1];

  it('décode la convention SUJET_VERBE', () => {
    expect(auditActionLabel('VERSION_PUBLISH', t)).toBe('Version audit.publish');
    expect(auditActionLabel('PROJECT_CREATE', t)).toBe('Project audit.create');
    expect(auditActionLabel('SHOT_BULK_MOVE', t)).toBe('Shot bulk audit.move');
  });

  it('traduit les verbes qui retombaient en anglais brut', () => {
    // « Hdri add », « Share revoke », « Share view » s'affichaient tels quels dans les 14 langues.
    expect(auditActionLabel('HDRI_ADD', t)).toBe('Hdri audit.add');
    expect(auditActionLabel('SHARE_REVOKE', t)).toBe('Share audit.revoke');
    expect(auditActionLabel('SHARE_VIEW', t)).toBe('Share audit.view');
    expect(auditActionLabel('EPISODES_ENABLE', t)).toBe('Episodes audit.enable');
  });

  it('nomme en toutes lettres les décisions de review', () => {
    expect(auditActionLabel('VERSION_DECISION', t)).toBe('audit.versionDecision');
    expect(auditActionLabel('VERSION_DECISION_BULK', t)).toBe('audit.versionDecisionBulk');
  });

  it('reste lisible sur les lignes déjà écrites en notation pointée', () => {
    // Le décodeur imprimait la clé DEUX FOIS : « version.decision version.decision ».
    expect(auditActionLabel('version.decision', t)).toBe('audit.versionDecision');
    expect(auditActionLabel('version.decision.bulk', t)).toBe('audit.versionDecisionBulk');
  });

  it('n’imprime jamais une action deux fois, même inconnue', () => {
    expect(auditActionLabel('inconnu', t)).toBe('inconnu');
    expect(auditActionLabel('autre.chose', t)).toBe('autre.chose');
  });
});

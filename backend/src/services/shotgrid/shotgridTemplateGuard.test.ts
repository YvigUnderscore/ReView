// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { assertNotTemplateProject, looksLikeTemplate, writeAllowedOn } from './shotgridTemplateGuard';

/**
 * Un projet modèle sert de gabarit à tous les projets à venir : y écrire ne casse pas
 * un projet, il les casse tous, et personne ne fait le lien avant longtemps.
 */
describe('looksLikeTemplate', () => {
  it('reconnaît les gabarits usuels d’un site', () => {
    expect(looksLikeTemplate('Template Project')).toBe(true);
    expect(looksLikeTemplate('template')).toBe(true);
    expect(looksLikeTemplate('_TEMPLATE_2026')).toBe(true);
    expect(looksLikeTemplate('Project Template')).toBe(true);
    expect(looksLikeTemplate('zz_template')).toBe(true);
  });

  it('laisse passer un projet de production, même si le mot apparaît ailleurs', () => {
    expect(looksLikeTemplate('M4_2027_DO_I_END_TOO')).toBe(false);
    expect(looksLikeTemplate('Demo Project')).toBe(false);
    // « templating » est un sujet de production, pas un gabarit.
    expect(looksLikeTemplate('Templating Research')).toBe(false);
    expect(looksLikeTemplate(null)).toBe(false);
  });
});

describe('assertNotTemplateProject', () => {
  it('refuse de relier un gabarit', () => {
    expect(() => assertNotTemplateProject('Template Project', 63)).toThrow();
  });

  it('laisse relier un projet de production', () => {
    expect(() => assertNotTemplateProject('M4_2027_UMBRA', 2687)).not.toThrow();
  });
});

describe('writeAllowedOn', () => {
  it('autorise une entité d’un projet de production', () => {
    expect(
      writeAllowedOn({ id: 1, type: 'Shot', project: { type: 'Project', id: 2680, name: 'M4_2027_UMBRA' } }),
    ).toBe(true);
  });

  it('refuse une entité appartenant à un gabarit', () => {
    expect(
      writeAllowedOn({ id: 1, type: 'Shot', project: { type: 'Project', id: 63, name: 'Template Project' } }),
    ).toBe(false);
  });

  it('refuse le gabarit lui-même et l’absence d’information', () => {
    expect(writeAllowedOn({ id: 63, type: 'Project', name: 'Template Project' })).toBe(false);
    expect(writeAllowedOn(null)).toBe(false);
  });
});

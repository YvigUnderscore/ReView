// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { assertNotTemplateProject, looksLikeTemplate, writeAllowedOn } from './shotgridTemplateGuard';

/**
 * A template project serves as the template for all future projects: writing into it does not break one project, it breaks them all, and nobody links the two for a long time.
 */
describe('looksLikeTemplate', () => {
  it('recognizes the usual templates of a site', () => {
    expect(looksLikeTemplate('Template Project')).toBe(true);
    expect(looksLikeTemplate('template')).toBe(true);
    expect(looksLikeTemplate('_TEMPLATE_2026')).toBe(true);
    expect(looksLikeTemplate('Project Template')).toBe(true);
    expect(looksLikeTemplate('zz_template')).toBe(true);
  });

  it('lets a production project through, even if the word appears elsewhere', () => {
    expect(looksLikeTemplate('M4_2027_DO_I_END_TOO')).toBe(false);
    expect(looksLikeTemplate('Demo Project')).toBe(false);
    // "templating" is a production subject, not a template.
    expect(looksLikeTemplate('Templating Research')).toBe(false);
    expect(looksLikeTemplate(null)).toBe(false);
  });
});

describe('assertNotTemplateProject', () => {
  it('refuses to link a template', () => {
    expect(() => assertNotTemplateProject('Template Project', 63)).toThrow();
  });

  it('lets a production project be linked', () => {
    expect(() => assertNotTemplateProject('M4_2027_UMBRA', 2687)).not.toThrow();
  });
});

describe('writeAllowedOn', () => {
  it('allows an entity of a production project', () => {
    expect(
      writeAllowedOn({ id: 1, type: 'Shot', project: { type: 'Project', id: 2680, name: 'M4_2027_UMBRA' } }),
    ).toBe(true);
  });

  it('refuses an entity belonging to a template', () => {
    expect(
      writeAllowedOn({ id: 1, type: 'Shot', project: { type: 'Project', id: 63, name: 'Template Project' } }),
    ).toBe(false);
  });

  it('refuses the template itself and the absence of information', () => {
    expect(writeAllowedOn({ id: 63, type: 'Project', name: 'Template Project' })).toBe(false);
    expect(writeAllowedOn(null)).toBe(false);
  });
});

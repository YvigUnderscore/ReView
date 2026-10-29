// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import {
  belongsToProject,
  eventBelongsToProject,
  projectFilter,
  projectNameMatches,
} from './shotgridProjectGuard';

/**
 * Project isolation is the most critical guarantee of the integration: a ShotGrid site hosts all the studio's projects, and writing into the wrong one cannot be undone.
 * These tests describe real situations — reused identifier, overly broad webhook, entity without a project — not only the easy cases.
 */

const scope = { sgProjectId: 70, sgProjectName: 'Demo Project' };

describe('projectFilter', () => {
  it('produces the filter that every project search must carry', () => {
    expect(projectFilter(70)).toEqual(['project', 'is', { type: 'Project', id: 70 }]);
  });
});

describe('belongsToProject', () => {
  it('accepts an entity of the linked project', () => {
    const shot = { id: 2011, type: 'Shot', code: 'SH010', project: { type: 'Project', id: 70 } };
    expect(belongsToProject(shot, scope)).toEqual({ ok: true });
  });

  it('refuses an entity from another project, even with the same code', () => {
        // The simulator deliberately gives the same code to two projects: this is the scenario where a filter error would overwrite the neighbouring project's work.
    const jumeau = { id: 3011, type: 'Shot', code: 'SH010', project: { type: 'Project', id: 71 } };
    expect(belongsToProject(jumeau, scope)).toEqual({
      ok: false,
      reason: 'wrong_project',
      foundProjectId: 71,
    });
  });

  it('refuses a project entity whose attachment is absent or unreadable', () => {
    expect(belongsToProject({ id: 1, type: 'Shot' }, scope).ok).toBe(false);
    expect(belongsToProject({ id: 1, type: 'Shot', project: null }, scope).ok).toBe(false);
    expect(belongsToProject({ id: 1, type: 'Shot', project: 'Demo Project' }, scope).ok).toBe(false);
  });

  it('lets the site\'s global entities through', () => {
    expect(belongsToProject({ id: 3, type: 'Status', code: 'ip' }, scope).ok).toBe(true);
    expect(belongsToProject({ id: 500, type: 'HumanUser' }, scope).ok).toBe(true);
    expect(belongsToProject({ id: 301, type: 'Step' }, scope).ok).toBe(true);
  });

  it('checks the project itself by its identifier', () => {
    expect(belongsToProject({ id: 70, type: 'Project', name: 'Demo Project' }, scope).ok).toBe(true);
    expect(belongsToProject({ id: 71, type: 'Project', name: 'Demo Project 2' }, scope)).toEqual({
      ok: false,
      reason: 'wrong_project',
      foundProjectId: 71,
    });
  });
});

describe('projectNameMatches', () => {
  it('tolerates case and edge spaces', () => {
    expect(projectNameMatches('Demo Project', 'Demo Project')).toBe(true);
    expect(projectNameMatches('  demo project ', 'Demo Project')).toBe(true);
  });

  it('refuses a neighbouring name: that is the whole point of the check', () => {
        // "Demo Project 2" exists on the same site: the confusion is plausible.
    expect(projectNameMatches('Demo Project 2', 'Demo Project')).toBe(false);
    expect(projectNameMatches('DemoProject', 'Demo Project')).toBe(false);
    expect(projectNameMatches(null, 'Demo Project')).toBe(false);
    expect(projectNameMatches(undefined, 'Demo Project')).toBe(false);
  });
});

describe('eventBelongsToProject', () => {
  it('accepts an event of the linked project', () => {
    expect(
      eventBelongsToProject({ project: { type: 'Project', id: 70 }, entity: { type: 'Shot', id: 1 } }, scope),
    ).toBe(true);
  });

  it('refuses an event from another project: webhook configured too broadly', () => {
    expect(
      eventBelongsToProject({ project: { type: 'Project', id: 71 }, entity: { type: 'Shot', id: 1 } }, scope),
    ).toBe(false);
  });

  it('accepts an event without a project only for a global entity', () => {
    expect(eventBelongsToProject({ entity: { type: 'Status', id: 3 } }, scope)).toBe(true);
    expect(eventBelongsToProject({ entity: { type: 'Shot', id: 1 } }, scope)).toBe(false);
    expect(eventBelongsToProject({}, scope)).toBe(false);
  });
});

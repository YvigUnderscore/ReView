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
 * Le cloisonnement des projets est la garantie la plus critique de l'intégration :
 * un site ShotGrid héberge tous les projets du studio, et écrire dans le mauvais ne
 * se rattrape pas. Ces tests décrivent des situations réelles — identifiant réutilisé,
 * webhook trop large, entité sans projet — pas seulement des cas passants.
 */

const scope = { sgProjectId: 70, sgProjectName: 'Demo Project' };

describe('projectFilter', () => {
  it('produit le filtre que toute recherche de projet doit porter', () => {
    expect(projectFilter(70)).toEqual(['project', 'is', { type: 'Project', id: 70 }]);
  });
});

describe('belongsToProject', () => {
  it('accepte une entité du projet lié', () => {
    const shot = { id: 2011, type: 'Shot', code: 'SH010', project: { type: 'Project', id: 70 } };
    expect(belongsToProject(shot, scope)).toEqual({ ok: true });
  });

  it('refuse une entité d’un autre projet, même code identique', () => {
    // Le simulateur donne volontairement le même code à deux projets : c'est le
    // scénario où une erreur de filtre écraserait le travail du projet voisin.
    const jumeau = { id: 3011, type: 'Shot', code: 'SH010', project: { type: 'Project', id: 71 } };
    expect(belongsToProject(jumeau, scope)).toEqual({
      ok: false,
      reason: 'wrong_project',
      foundProjectId: 71,
    });
  });

  it('refuse une entité de projet dont le rattachement est absent ou illisible', () => {
    expect(belongsToProject({ id: 1, type: 'Shot' }, scope).ok).toBe(false);
    expect(belongsToProject({ id: 1, type: 'Shot', project: null }, scope).ok).toBe(false);
    expect(belongsToProject({ id: 1, type: 'Shot', project: 'Demo Project' }, scope).ok).toBe(false);
  });

  it('laisse passer les entités globales du site', () => {
    expect(belongsToProject({ id: 3, type: 'Status', code: 'ip' }, scope).ok).toBe(true);
    expect(belongsToProject({ id: 500, type: 'HumanUser' }, scope).ok).toBe(true);
    expect(belongsToProject({ id: 301, type: 'Step' }, scope).ok).toBe(true);
  });

  it('vérifie le projet lui-même par son identifiant', () => {
    expect(belongsToProject({ id: 70, type: 'Project', name: 'Demo Project' }, scope).ok).toBe(true);
    expect(belongsToProject({ id: 71, type: 'Project', name: 'Demo Project 2' }, scope)).toEqual({
      ok: false,
      reason: 'wrong_project',
      foundProjectId: 71,
    });
  });
});

describe('projectNameMatches', () => {
  it('tolère la casse et les espaces de bord', () => {
    expect(projectNameMatches('Demo Project', 'Demo Project')).toBe(true);
    expect(projectNameMatches('  demo project ', 'Demo Project')).toBe(true);
  });

  it('refuse un nom voisin — c’est tout l’intérêt du contrôle', () => {
    // « Demo Project 2 » existe sur le même site : la confusion est plausible.
    expect(projectNameMatches('Demo Project 2', 'Demo Project')).toBe(false);
    expect(projectNameMatches('DemoProject', 'Demo Project')).toBe(false);
    expect(projectNameMatches(null, 'Demo Project')).toBe(false);
    expect(projectNameMatches(undefined, 'Demo Project')).toBe(false);
  });
});

describe('eventBelongsToProject', () => {
  it('accepte un événement du projet lié', () => {
    expect(
      eventBelongsToProject({ project: { type: 'Project', id: 70 }, entity: { type: 'Shot', id: 1 } }, scope),
    ).toBe(true);
  });

  it('refuse un événement d’un autre projet — webhook configuré trop large', () => {
    expect(
      eventBelongsToProject({ project: { type: 'Project', id: 71 }, entity: { type: 'Shot', id: 1 } }, scope),
    ).toBe(false);
  });

  it('accepte un événement sans projet seulement pour une entité globale', () => {
    expect(eventBelongsToProject({ entity: { type: 'Status', id: 3 } }, scope)).toBe(true);
    expect(eventBelongsToProject({ entity: { type: 'Shot', id: 1 } }, scope)).toBe(false);
    expect(eventBelongsToProject({}, scope)).toBe(false);
  });
});

// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { linkFor } from './notificationTarget';

/**
 * La destination d'une notification. Deux défauts vivaient ici :
 *
 * - le type `REVIEW_DECISION` manquait à la table, si bien que le verdict d'une review —
 *   la notification la plus attendue du lot — retombait sur la page du projet ;
 * - le même événement écrivait deux `referenceId` de natures différentes (un id de version
 *   pour l'auteur, un id de média pour les suiveurs). Le serveur n'en écrit plus qu'un, et
 *   le front refuse donc les lignes à l'ancienne graphie, dont la référence n'est pas fiable.
 */
const base = { projectId: 12 };

describe('linkFor', () => {
  it('ouvre la tâche assignée', () => {
    expect(linkFor({ ...base, type: 'TASK_ASSIGNED', referenceId: 5 })).toBe('/tasks/5');
  });

  it('ouvre la review pour tous les types portés par un média', () => {
    for (const type of ['REPLY', 'COMMENT_ASSIGNED', 'REVIEW_ASSIGNED', 'MENTION', 'WATCH']) {
      expect(linkFor({ ...base, type, referenceId: 9 })).toBe('/review/9');
    }
  });

  it('ouvre la review sur une décision de review', () => {
    expect(linkFor({ ...base, type: 'REVIEW_DECISION', referenceId: 9 })).toBe('/review/9');
  });

  it('laisse les anciennes lignes `review_decision` sur la page projet', () => {
    // Leur `referenceId` est un id de VERSION chez l'auteur : les router vers /review
    // ouvrirait un média pris au hasard. Le repli projet est le comportement d'avant.
    expect(linkFor({ ...base, type: 'review_decision', referenceId: 9 })).toBe('/projects/12');
  });

  it('retombe sur le projet quand la référence manque', () => {
    expect(linkFor({ ...base, type: 'MENTION', referenceId: null })).toBe('/projects/12');
    expect(linkFor({ ...base, type: 'SYSTEM', referenceId: null })).toBe('/projects/12');
  });

  it('ne mène nulle part sans projet ni référence', () => {
    expect(linkFor({ type: 'SYSTEM', referenceId: null, projectId: null })).toBeNull();
  });
});

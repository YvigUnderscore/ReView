// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import type { MessageKey } from '../i18n';
import type { PipelineStatus } from '../types/shotgrid';
import {
  NO_STATUS,
  bodyForChoice,
  currentStatusValue,
  statusChoices,
  withStatus,
  withStatusOne,
} from './statusMenu';

const t = (key: MessageKey) => key;

const status = (over: Partial<PipelineStatus> & { id: number }): PipelineStatus => ({
  scope: 'task',
  code: 'ip',
  name: 'In Progress',
  color: '#3B82F6',
  order: 0,
  isDone: false,
  isDefault: false,
  legacyStatus: 'IN_PROGRESS',
  ...over,
});

describe('statusChoices', () => {
  it('rend un choix par statut du référentiel, dans l’ordre reçu', () => {
    const choices = statusChoices(
      [status({ id: 1, name: 'Waiting', code: 'wtg' }), status({ id: 2 })],
      'shot',
      t,
    );
    expect(choices.map((c) => c.value)).toEqual(['1', '2']);
    // Le nom d'un statut est une donnée du studio : jamais traduit, jamais réécrit.
    expect(choices[0].label).toBe('Waiting');
    expect(choices[0].color).toBe('#3B82F6');
  });

  it('retombe sur les six valeurs historiques pour une tâche sans référentiel', () => {
    const choices = statusChoices([], 'task', t);
    expect(choices).toHaveLength(6);
    expect(choices[0].value).toBe('legacy:TODO');
    expect(choices[0].statusId).toBeNull();
  });

  it('ne propose rien pour un plan ou une séquence sans référentiel', () => {
    // Leur PATCH n'accepte que `pipelineStatusId` : proposer les valeurs historiques
    // donnerait un menu qui échoue à tous les coups. Mieux vaut ne pas l'afficher.
    expect(statusChoices([], 'shot', t)).toEqual([]);
    expect(statusChoices([], 'sequence', t)).toEqual([]);
  });
});

describe('currentStatusValue', () => {
  const choices = statusChoices([status({ id: 7 }), status({ id: 8, legacyStatus: 'APPROVED' })], 'task', t);

  it('retrouve le choix par son identifiant', () => {
    expect(currentStatusValue(choices, { pipelineStatusId: 8 })).toBe('8');
  });

  it('retombe sur la même famille quand l’identifiant n’est plus offert', () => {
    // Statut hérité d'un autre site ou d'un vocabulaire changé : montrer la famille vaut
    // mieux que prétendre qu'aucun statut n'est posé.
    expect(currentStatusValue(choices, { pipelineStatusId: 999, status: 'APPROVED' })).toBe('8');
  });

  it('rend la sentinelle quand rien n’est posé', () => {
    expect(currentStatusValue(choices, {})).toBe(NO_STATUS);
  });
});

describe('bodyForChoice', () => {
  const choices = statusChoices([status({ id: 12 })], 'task', t);

  it('envoie l’identifiant seul pour un statut du référentiel', () => {
    const body = bodyForChoice(choices, '12');
    expect(body).toEqual({ pipelineStatusId: 12 });
    // Surtout pas `status` en plus : le serveur le déduit et sa déduction prime.
    expect(body && 'status' in body).toBe(false);
  });

  it('envoie l’énumération pour un choix de repli', () => {
    expect(bodyForChoice(statusChoices([], 'task', t), 'legacy:IN_PROGRESS')).toEqual({
      status: 'IN_PROGRESS',
    });
  });

  it('efface le statut sur la sentinelle', () => {
    expect(bodyForChoice(choices, NO_STATUS)).toEqual({ pipelineStatusId: null });
  });

  it('ne fabrique rien pour une valeur inconnue', () => {
    expect(bodyForChoice(choices, '404')).toBeNull();
  });
});

describe('withStatus', () => {
  const choice = statusChoices([status({ id: 5, legacyStatus: 'APPROVED' })], 'task', t)[0];

  it('écrit les deux champs pour que colonne et pastille suivent ensemble', () => {
    const next = withStatusOne({ id: 1, name: 'x', pipelineStatusId: null, status: 'TODO' as const }, choice);
    expect(next.pipelineStatusId).toBe(5);
    expect(next.status).toBe('APPROVED');
    expect(next.name).toBe('x');
  });

  it('efface les deux champs sur un retrait', () => {
    expect(withStatusOne({ id: 1, pipelineStatusId: 5 }, null).pipelineStatusId).toBeNull();
  });

  it('ne touche que l’élément visé dans une liste', () => {
    const list = [
      { id: 1, pipelineStatusId: null },
      { id: 2, pipelineStatusId: null },
    ];
    const next = withStatus(list, 2, choice);
    expect(next[0].pipelineStatusId).toBeNull();
    expect(next[1].pipelineStatusId).toBe(5);
  });
});

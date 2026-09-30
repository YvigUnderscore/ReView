// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { TaskStatus } from '@prisma/client';
import {
  FAMILY_OF_ENUM,
  FAMILY_PRIORITY,
  TASK_BLOCKED_FILTER,
  TASK_OPEN_FILTER,
  TASK_REVIEW_FILTER,
  familyOf,
  statusRefOf,
  taskPriority,
} from './statusFamily';

describe('statusFamily — repli sur l’enum figé', () => {
  it('traduit les six statuts historiques, statut personnalisable absent', () => {
    // Comportement d'origine : un studio sans ShotGrid ne doit rien voir changer.
    expect(familyOf(TaskStatus.TODO)).toBe('todo');
    expect(familyOf(TaskStatus.IN_PROGRESS, null)).toBe('progress');
    expect(familyOf(TaskStatus.PENDING_REVIEW, null)).toBe('review');
    expect(familyOf(TaskStatus.APPROVED, null)).toBe('done');
    expect(familyOf(TaskStatus.RETAKE, null)).toBe('blocked');
    expect(familyOf(TaskStatus.REJECTED, null)).toBe('blocked');
  });

  it('couvre exactement l’enum', () => {
    expect(Object.keys(FAMILY_OF_ENUM).sort()).toEqual(Object.values(TaskStatus).sort());
  });
});

describe('statusFamily — référentiel PipelineStatus', () => {
  const ref = (over: Partial<{ isDone: boolean; isInactive: boolean; legacyStatus: TaskStatus | null }>) => ({
    isDone: false,
    isInactive: false,
    legacyStatus: null,
    ...over,
  });

  it('compte comme fait ce que le site déclare terminal, quel que soit l’enum', () => {
    // « fin » sur un site ShotGrid : l'enum local dit encore IN_PROGRESS.
    expect(familyOf(TaskStatus.IN_PROGRESS, ref({ isDone: true }))).toBe('done');
  });

  it('sort des jauges les statuts inactifs, même marqués terminaux', () => {
    expect(familyOf(TaskStatus.TODO, ref({ isInactive: true }))).toBe('inactive');
    expect(familyOf(TaskStatus.APPROVED, ref({ isInactive: true, isDone: true }))).toBe('inactive');
  });

  it('emprunte le pont legacyStatus pour les familles intermédiaires', () => {
    expect(familyOf(TaskStatus.TODO, ref({ legacyStatus: TaskStatus.PENDING_REVIEW }))).toBe('review');
    expect(familyOf(TaskStatus.TODO, ref({ legacyStatus: TaskStatus.RETAKE }))).toBe('blocked');
  });

  it('retombe sur l’enum de la tâche quand le pont est vide', () => {
    expect(familyOf(TaskStatus.IN_PROGRESS, ref({}))).toBe('progress');
  });

  it('ne laisse jamais un statut non terminal compter comme fait', () => {
    // Pont mal renseigné (APPROVED) mais isDone faux : la jauge n'a pas le droit de mentir.
    expect(familyOf(TaskStatus.TODO, ref({ legacyStatus: TaskStatus.APPROVED }))).toBe('review');
    expect(familyOf(TaskStatus.APPROVED, ref({}))).toBe('review');
  });
});

describe('statusFamily — statusRefOf', () => {
  it('lit « aucun statut posé » sur isDone nul, pas « pas terminé »', () => {
    expect(statusRefOf({ isDone: null, isInactive: null, legacyStatus: null })).toBeNull();
  });

  it('reconstitue la référence depuis des colonnes à plat', () => {
    expect(statusRefOf({ isDone: false, isInactive: null, legacyStatus: TaskStatus.RETAKE })).toEqual({
      isDone: false,
      isInactive: false,
      legacyStatus: TaskStatus.RETAKE,
    });
  });
});

describe('statusFamily — priorité d’affichage', () => {
  it('place ce qui bloque devant, ce qui est clos derrière', () => {
    const order = (['blocked', 'review', 'progress', 'todo', 'done', 'inactive'] as const).map(
      (f) => FAMILY_PRIORITY[f],
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('conserve exactement l’ordre historique sans statut personnalisable', () => {
    // L'ordre d'origine : RETAKE, REJECTED, PENDING_REVIEW, IN_PROGRESS, TODO, APPROVED.
    const legacyOrder = [
      TaskStatus.RETAKE,
      TaskStatus.REJECTED,
      TaskStatus.PENDING_REVIEW,
      TaskStatus.IN_PROGRESS,
      TaskStatus.TODO,
      TaskStatus.APPROVED,
    ];
    const scores = legacyOrder.map((s) => taskPriority(s));
    expect(scores).toEqual([...scores].sort((a, b) => a - b));
    expect(new Set(scores).size).toBe(scores.length);
  });

  it('classe sur la famille du site avant l’enum local', () => {
    // « rtk » côté ShotGrid : l'enum dit IN_PROGRESS, la tâche doit passer devant un TODO.
    const retakeFromSite = taskPriority(TaskStatus.IN_PROGRESS, {
      isDone: false,
      isInactive: false,
      legacyStatus: TaskStatus.RETAKE,
    });
    expect(retakeFromSite).toBeLessThan(taskPriority(TaskStatus.TODO));
  });
});

describe('statusFamily — filtres Prisma', () => {
  it('écartent toujours le terminal et l’inactif du référentiel', () => {
    for (const filter of [TASK_OPEN_FILTER, TASK_REVIEW_FILTER, TASK_BLOCKED_FILTER]) {
      const json = JSON.stringify(filter);
      expect(json).toContain('"isDone":false');
      expect(json).toContain('"isInactive":false');
    }
  });

  it('gardent le repli sur l’enum quand aucun statut personnalisable n’est posé', () => {
    expect(JSON.stringify(TASK_OPEN_FILTER)).toContain('"pipelineStatusId":null');
    expect(JSON.stringify(TASK_REVIEW_FILTER)).toContain('PENDING_REVIEW');
    expect(JSON.stringify(TASK_BLOCKED_FILTER)).toContain('RETAKE');
    expect(JSON.stringify(TASK_BLOCKED_FILTER)).toContain('REJECTED');
  });

  it('couvrent le statut personnalisé sans pont, où l’enum de la tâche reprend la main', () => {
    // Trois branches : pas de statut posé, pont renseigné, pont vide.
    expect(TASK_REVIEW_FILTER.OR).toHaveLength(3);
    expect(TASK_BLOCKED_FILTER.OR).toHaveLength(3);
  });
});

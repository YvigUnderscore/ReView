// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { MediaStatus, Prisma, Role } from '@prisma/client';
import { TASK_BLOCKED_FILTER, TASK_OPEN_FILTER } from './statusFamily';
import {
  accessibleProjects,
  awaitingMyReviewWhere,
  commentFeedWhere,
  mediaInReviewWhere,
  myOpenTasksWhere,
  myRetakesWhere,
} from './homeScope';

/**
 * Les quatre compteurs de l'Accueil, sur leur périmètre.
 *
 * Chacun mentait à sa façon, et aucun de ces mensonges ne se voyait dans un chiffre : il
 * fallait connaître la base pour savoir que « mes retakes » comptait un projet à la
 * corbeille, ou que « awaiting review » — posé parmi mes chiffres — comptait le studio
 * entier. Ce sont donc les `where` eux-mêmes qu'on vérifie, pas la valeur rendue : c'est là
 * que la vérité se joue, et un test de valeur passerait sur une base vide.
 */

const artist = { id: 3, role: Role.ARTIST };
const admin = { id: 1, role: Role.ADMIN };
const client = { id: 8, role: Role.CLIENT };

/** Le projet accessible d'un ARTIST : vivant et dont il est membre. */
const mine = { deletedAt: null, memberships: { some: { userId: 3 } } };

/** Les trois chemins de rattachement d'une version, parents masqués exclus. */
const versionPaths = [
  { task: { shot: { deletedAt: null, hiddenAt: null, project: mine } } },
  { task: { asset: { deletedAt: null, hiddenAt: null, project: mine } } },
  { asset: { deletedAt: null, hiddenAt: null, project: mine } },
];

describe('accessibleProjects', () => {
  it('borne un ARTIST à ses projets vivants, et laisse tout le studio à un ADMIN', () => {
    expect(accessibleProjects(artist)).toEqual(mine);
    expect(accessibleProjects(admin)).toEqual({ deletedAt: null });
  });
});

describe('myRetakesWhere — « mes retakes »', () => {
  it('borne à mes tâches, à mes projets, hors corbeille et hors éléments masqués', () => {
    // Le compteur d'origine ne portait que `assigneeId` : une tâche d'un projet mis à la
    // corbeille, d'un plan masqué ou d'un projet dont je ne suis plus membre continuait de
    // réclamer une action qu'aucun écran ne pouvait plus montrer.
    const where = myRetakesWhere(artist);
    expect(where.assigneeId).toBe(3);
    const [scope, family] = where.AND as Prisma.TaskWhereInput[];
    expect(scope).toEqual({
      OR: [
        { shot: { deletedAt: null, hiddenAt: null, project: mine } },
        { asset: { deletedAt: null, hiddenAt: null, project: mine } },
      ],
    });
    // La famille « bloqué » est celle du reste du serveur, pas une copie locale : c'est elle
    // qui lit le référentiel du studio (`PipelineStatus`) et non l'enum figé.
    expect(family).toBe(TASK_BLOCKED_FILTER);
  });

  it('partage son périmètre avec la liste de mes tâches vivantes', () => {
    // La page « mes tâches » et le compteur doivent compter la même chose : seule la
    // famille de statut les distingue.
    const [scope] = myOpenTasksWhere(artist).AND as Prisma.TaskWhereInput[];
    const [retakeScope, family] = myRetakesWhere(artist).AND as Prisma.TaskWhereInput[];
    expect(scope).toEqual(retakeScope);
    expect((myOpenTasksWhere(artist).AND as Prisma.TaskWhereInput[])[1]).toBe(TASK_OPEN_FILTER);
    expect(family).toBe(TASK_BLOCKED_FILTER);
  });
});

describe('awaitingMyReviewWhere — « ce qu’on attend de moi »', () => {
  it('ne compte que les reviews qui m’ont été confiées, sans décision rendue', () => {
    // La carte est posée parmi mes chiffres et libellée à la première personne ; elle
    // comptait pourtant les verdicts attendus de tout le studio.
    const where = awaitingMyReviewWhere(artist);
    expect(where.deletedAt).toBeNull();
    expect(where.published).toBe(true);
    expect(where.status).toBe(MediaStatus.READY);
    const version = where.version as Prisma.VersionWhereInput;
    expect(version.reviewers).toEqual({ some: { reviewerId: 3 } });
    // Décision déjà rendue = plus rien à attendre de moi.
    expect(version.reviewStatusId).toBeNull();
    expect(version.deletedAt).toBeNull();
    expect(version.OR).toEqual(versionPaths);
  });
});

describe('mediaInReviewWhere — « media in review »', () => {
  it('exclut les versions déjà tranchées, et borne au périmètre accessible', () => {
    // Le compteur prenait TOUS les médias publiés et prêts : un projet livré depuis deux
    // ans y figurait encore, décisions rendues comprises.
    const where = mediaInReviewWhere(artist);
    expect(where.published).toBe(true);
    expect(where.status).toBe(MediaStatus.READY);
    const version = where.version as Prisma.VersionWhereInput;
    expect(version.reviewStatusId).toBeNull();
    expect(version.OR).toEqual(versionPaths);
    // Et rien de personnel ici : c'est le volume du périmètre, pas ma file.
    expect(version.reviewers).toBeUndefined();
  });
});

describe('commentFeedWhere — le fil des commentaires', () => {
  it('borne un CLIENT aux notes qui lui sont destinées, et personne d’autre', () => {
    expect(commentFeedWhere(client).isVisibleToClient).toBe(true);
    expect(commentFeedWhere(artist).isVisibleToClient).toBeUndefined();
    const media = commentFeedWhere(artist).media as Prisma.MediaObjectWhereInput;
    expect(media.published).toBe(true);
    expect((media.version as Prisma.VersionWhereInput).OR).toEqual(versionPaths);
  });
});

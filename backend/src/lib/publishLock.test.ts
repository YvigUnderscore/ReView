// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { MediaStatus } from '@prisma/client';
import {
  assertReprocessable,
  assertWritable,
  isAllowedWhilePublished,
  publishedReprocessCount,
  PUBLISHED_REPROCESS_ALLOWANCE,
  PUBLISHED_WRITES,
  withPublishedReprocess,
  type PublishedWrite,
} from './publishLock';
import { AppError } from './errors';

/**
 * Ce fichier testait la règle d'un seul mot de la Phase 11 : publié = figé, toute écriture
 * en 403. Cette règle a été REMPLACÉE par une table d'exceptions (Phase 50), parce que le
 * média est désormais publié dès son upload : la geler entièrement aurait interdit le
 * travail normal de review au moment même où il commence. Le test est donc réécrit sur la
 * table, pas désactivé — et il vérifie ce qui reste verrouillé aussi soigneusement que ce
 * qui s'ouvre, puisque c'est là que se trouve le choix.
 */

/** Ce que `forbidden` a levé, sous une forme comparable. */
function refusal(run: () => void): { status: number; code: string | undefined } {
  try {
    run();
    expect.fail('aurait dû lever');
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    return { status: (e as AppError).statusCode, code: (e as AppError).code };
  }
}

const ALL_WRITES: PublishedWrite[] = [
  'splatEdit',
  'usdOverride',
  'usdRecompose',
  'versionTransform',
  'uploadFinalize',
];

describe('publishLock — périmètre de la table', () => {
  /**
   * Commenter et annoter un média PUBLIÉ restent possibles : ce sont des remarques, pas des
   * éditions du contenu. Rien ne les soumet au verrou — ni la table (vérifiée ici), ni
   * `CommentService.create`, qui ne demande rien au verrou. Le jour où une écriture de
   * commentaire s'y présenterait, ce test tomberait.
   */
  it('ne connaît que des écritures de contenu — aucune de commentaire ni d’annotation', () => {
    expect([...PUBLISHED_WRITES].sort()).toEqual([...ALL_WRITES].sort());
    for (const write of PUBLISHED_WRITES) {
      expect(write).not.toMatch(/comment|annotation|poi/i);
    }
  });
});

describe('publishLock.assertWritable — table des exceptions au verrou', () => {
  it('laisse passer TOUTE écriture sur un brouillon', () => {
    for (const write of ALL_WRITES) {
      expect(() => assertWritable({ published: false }, write)).not.toThrow();
    }
  });

  it('ouvre les éditions non destructives sur un média publié', () => {
    for (const write of ['splatEdit', 'usdOverride', 'usdRecompose'] as PublishedWrite[]) {
      expect(isAllowedWhilePublished(write)).toBe(true);
      expect(() => assertWritable({ published: true }, write)).not.toThrow();
    }
  });

  // `videoTrim` a quitté la table avec la découpe elle-même (Phase 50, lot 4) : il ne reste
  // pas d'écriture « refusée pour mémoire » — une entrée sans appelant serait une règle que
  // plus rien n'applique.
  it('garde verrouillées la transform de version et la re-finalisation', () => {
    for (const write of ['versionTransform', 'uploadFinalize'] as PublishedWrite[]) {
      expect(isAllowedWhilePublished(write)).toBe(false);
      expect(refusal(() => assertWritable({ published: true }, write))).toEqual({
        status: 403,
        code: 'PUBLISHED_LOCKED',
      });
    }
  });
});

describe('publishLock.assertReprocessable — une relance après échec, pas deux', () => {
  const failed = (metadata: unknown = {}) => ({
    published: true,
    status: MediaStatus.FAILED,
    metadata,
  });

  it('laisse relancer un brouillon, quel que soit son état', () => {
    expect(() =>
      assertReprocessable({ published: false, status: MediaStatus.READY, metadata: {} }),
    ).not.toThrow();
  });

  it('refuse la relance d’un média publié SAIN, avec son propre code', () => {
    expect(
      refusal(() => assertReprocessable({ published: true, status: MediaStatus.READY, metadata: {} })),
    ).toEqual({ status: 403, code: 'REPROCESS_ONLY_AFTER_FAILURE' });
  });

  it('autorise la première relance d’un média publié en échec', () => {
    expect(() => assertReprocessable(failed())).not.toThrow();
    expect(() => assertReprocessable(failed(null))).not.toThrow();
  });

  it('refuse la deuxième, une fois la relance consommée', () => {
    const spent = withPublishedReprocess({ fps: 24 });
    expect(spent).toEqual({ fps: 24, publishedReprocessCount: PUBLISHED_REPROCESS_ALLOWANCE });
    expect(refusal(() => assertReprocessable(failed(spent)))).toEqual({
      status: 403,
      code: 'REPROCESS_ALREADY_RETRIED',
    });
  });

  it('lit un compteur abîmé comme zéro plutôt que de bloquer le rattrapage', () => {
    expect(publishedReprocessCount(undefined)).toBe(0);
    expect(publishedReprocessCount({ publishedReprocessCount: 'deux' })).toBe(0);
    expect(publishedReprocessCount({ publishedReprocessCount: -3 })).toBe(0);
    expect(publishedReprocessCount({ publishedReprocessCount: 1.9 })).toBe(1);
    expect(() => assertReprocessable(failed({ publishedReprocessCount: 'deux' }))).not.toThrow();
  });
});

// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { planDrop, sendPlan, withUploadNote } = vi.hoisted(() => ({
  planDrop: vi.fn(),
  sendPlan: vi.fn(),
  withUploadNote: vi.fn(),
}));

vi.mock('./useSequenceUploadStore', () => ({ planDrop, sendPlan }));
vi.mock('./useUploadNoteStore', () => ({ withUploadNote }));

import { deliverFiles } from './deliverFiles';

/**
 * Le point d'entrée unique d'un dépôt.
 *
 * Ce qui doit tenir : l'ordre (regroupement → consigne → cible), et le fait que renoncer à
 * un dialogue ne touche jamais la cible — c'est elle qui crée la version, et une version
 * vide est précisément ce qu'un dépôt abandonné ne doit pas laisser.
 */

const file = (name: string): File => ({ name, size: 1 }) as unknown as File;
const decided = { sequences: [], singles: [file('a.mov')] };

beforeEach(() => {
  vi.clearAllMocks();
  planDrop.mockResolvedValue(decided);
  // Projet sans consigne obligatoire : le geste reprend aussitôt, sans message.
  withUploadNote.mockImplementation(async (_projectId: number, run: (note: string | null) => unknown) => {
    await run('Comp v3');
  });
});

describe('deliverFiles', () => {
  it('envoie le plan retenu dans la version que la cible désigne, avec la consigne', async () => {
    const target = vi.fn((send: (versionId: number) => void) => send(12));
    await deliverFiles(3, [file('a.mov')], target);
    expect(withUploadNote).toHaveBeenCalledWith(3, expect.any(Function));
    expect(sendPlan).toHaveBeenCalledWith(decided, 12, 'Comp v3');
  });

  it('ne touche pas la cible quand le regroupement est abandonné', async () => {
    planDrop.mockResolvedValue(null);
    const target = vi.fn();
    await deliverFiles(3, [file('plan.1001.exr'), file('plan.1002.exr')], target);
    expect(withUploadNote).not.toHaveBeenCalled();
    expect(target).not.toHaveBeenCalled();
  });

  it('propose le regroupement AVANT de demander la consigne', async () => {
    const order: string[] = [];
    planDrop.mockImplementation(() => {
      order.push('regroupement');
      return Promise.resolve(decided);
    });
    withUploadNote.mockImplementation(() => {
      order.push('consigne');
      return Promise.resolve();
    });
    await deliverFiles(3, [file('a.mov')], vi.fn());
    expect(order).toEqual(['regroupement', 'consigne']);
  });

  it('ignore un dépôt vide (dossier sans fichier lisible)', async () => {
    const target = vi.fn();
    await deliverFiles(3, [], target);
    expect(planDrop).not.toHaveBeenCalled();
    expect(target).not.toHaveBeenCalled();
  });
});

// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { enqueue, upload, toasts } = vi.hoisted(() => ({
  enqueue: vi.fn(),
  upload: vi.fn(),
  toasts: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock('sonner', () => ({ toast: toasts }));
vi.mock('./useUploadStore', () => ({ useUploadStore: { getState: () => ({ enqueue }) } }));
vi.mock('../lib/sequenceUpload', () => ({ uploadImageSequence: upload }));
vi.mock('../lib/apiClient', () => ({ api: { get: vi.fn(), post: vi.fn() } }));

import { planDrop, sendPlan, useSequenceUploadStore } from './useSequenceUploadStore';

/**
 * Le point d'entrée d'un dépôt.
 *
 * La règle du lot est là : **proposer, jamais imposer**. Rien ne part tant que
 * l'utilisateur n'a pas tranché, et un dépôt sans motif reconnu ne doit ni ouvrir de
 * dialogue ni changer quoi que ce soit au comportement d'avant. La décision rend la main
 * au dépôt (`planDrop`), qui n'envoie qu'ensuite (`sendPlan`) : c'est ce qui permet de ne
 * créer la version qu'une fois le dialogue tranché.
 */

const file = (name: string, size = 1000): File => ({ name, size }) as unknown as File;
const plan = (from: number, to: number): File[] =>
  Array.from({ length: to - from + 1 }, (_, i) => file(`plan.${String(from + i).padStart(4, '0')}.exr`));

const reset = (): void => {
  useSequenceUploadStore.setState({ proposal: null, uploads: [] });
};

beforeEach(() => {
  vi.clearAllMocks();
  reset();
  upload.mockResolvedValue({ mediaObjectId: 7, status: 'PROCESSING', frameCount: 10, missingFrames: 0 });
});

/** Ouvre la proposition et rend la promesse du dépôt, encore pendante. */
const propose = (files: File[]) => {
  const pending = planDrop(files);
  return { pending, proposal: useSequenceUploadStore.getState().proposal };
};

describe('planDrop', () => {
  it('rend le dépôt tel quel, sans dialogue, quand aucun motif n’est reconnu', async () => {
    const files = [file('plan.mov'), file('brief.pdf')];
    await expect(planDrop(files)).resolves.toEqual({ sequences: [], singles: files });
    expect(useSequenceUploadStore.getState().proposal).toBeNull();
  });

  it('ouvre la proposition et n’envoie RIEN tant que l’utilisateur n’a pas tranché', () => {
    const { proposal } = propose([...plan(1001, 1010), file('notes.txt')]);
    expect(proposal?.sequences.map((s) => s.pattern)).toEqual(['plan.%04d.exr']);
    expect(proposal?.singles.map((s) => s.name)).toEqual(['notes.txt']);
    expect(enqueue).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });

  it('abandonne explicitement un dépôt encore en attente quand un autre arrive', async () => {
    const first = propose(plan(1001, 1010));
    propose(plan(2001, 2005));
    await expect(first.pending).resolves.toBeNull();
    expect(useSequenceUploadStore.getState().proposal?.sequences[0].startFrame).toBe(2001);
  });
});

describe('acceptProposal', () => {
  it('rend la séquence retenue, et le reste en fichiers', async () => {
    const { pending, proposal } = propose([...plan(1001, 1010), file('notes.txt')]);
    useSequenceUploadStore.getState().acceptProposal(proposal!.sequences);
    const decided = await pending;
    expect(decided?.sequences.map((s) => s.pattern)).toEqual(['plan.%04d.exr']);
    expect(decided?.singles.map((f) => f.name)).toEqual(['notes.txt']);
    expect(useSequenceUploadStore.getState().proposal).toBeNull();
  });

  it('rend ses frames en fichiers isolés quand la séquence est refusée', async () => {
    const { pending } = propose(plan(1001, 1010));
    useSequenceUploadStore.getState().acceptProposal([]);
    const decided = await pending;
    expect(decided?.sequences).toEqual([]);
    expect(decided?.singles).toHaveLength(10);
  });
});

describe('cancelProposal', () => {
  it('referme sans rien envoyer, et le dépôt apprend qu’il est abandonné', async () => {
    const { pending } = propose(plan(1001, 1010));
    useSequenceUploadStore.getState().cancelProposal();
    await expect(pending).resolves.toBeNull();
    expect(useSequenceUploadStore.getState().proposal).toBeNull();
    expect(enqueue).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });
});

describe('sendPlan', () => {
  const sequenceOf = (files: File[]) => {
    const { pending, proposal } = propose(files);
    useSequenceUploadStore.getState().acceptProposal(proposal!.sequences);
    return pending.then((p) => p!);
  };

  it('envoie la séquence en UN média et les fichiers isolés dans la file ordinaire', async () => {
    sendPlan(await sequenceOf([...plan(1001, 1010), file('notes.txt')]), 4, 'Comp v3');
    expect(useSequenceUploadStore.getState().uploads).toHaveLength(1);
    expect(useSequenceUploadStore.getState().uploads[0]).toMatchObject({
      pattern: 'plan.%04d.exr',
      totalFrames: 10,
      versionId: 4,
    });
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ name: 'notes.txt' }), 4, {
      note: 'Comp v3',
    });
  });

  it('porte la consigne jusqu’à l’envoi de la séquence', async () => {
    sendPlan(await sequenceOf(plan(1001, 1010)), 4, 'Comp v3');
    await vi.waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    expect(upload).toHaveBeenCalledWith(
      expect.objectContaining({ pattern: 'plan.%04d.exr' }),
      4,
      expect.objectContaining({ note: 'Comp v3' }),
    );
  });

  it('signale une livraison à trous plutôt que de la laisser passer sans un mot', async () => {
    upload.mockResolvedValue({ mediaObjectId: 7, status: 'PROCESSING', frameCount: 9, missingFrames: 1 });
    sendPlan(await sequenceOf(plan(1001, 1010)), 4, null);
    await vi.waitFor(() => expect(toasts.warning).toHaveBeenCalledTimes(1));
    expect(useSequenceUploadStore.getState().uploads[0].status).toBe('processing');
  });

  it('remonte l’échec sans effacer la ligne : l’artiste doit voir ce qui a raté', async () => {
    upload.mockRejectedValue(new Error('403'));
    sendPlan(await sequenceOf(plan(1001, 1010)), 4, null);
    await vi.waitFor(() => expect(useSequenceUploadStore.getState().uploads[0].status).toBe('error'));
  });
});

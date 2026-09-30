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

import { useSequenceUploadStore } from './useSequenceUploadStore';

/**
 * Le point d'entrée d'un dépôt.
 *
 * La règle du lot est là : **proposer, jamais imposer**. Rien ne part tant que
 * l'utilisateur n'a pas tranché, et un dépôt sans motif reconnu ne doit ni ouvrir de
 * dialogue ni changer quoi que ce soit au comportement d'avant.
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

describe('proposeDrop', () => {
  it('n’ouvre aucune proposition et n’envoie rien de spécial sans motif reconnu', () => {
    useSequenceUploadStore.getState().proposeDrop([file('plan.mov'), file('brief.pdf')], 4);
    expect(useSequenceUploadStore.getState().proposal).toBeNull();
    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(upload).not.toHaveBeenCalled();
  });

  it('ouvre la proposition et n’envoie RIEN tant que l’utilisateur n’a pas tranché', () => {
    useSequenceUploadStore.getState().proposeDrop([...plan(1001, 1010), file('notes.txt')], 4);
    const proposal = useSequenceUploadStore.getState().proposal;
    expect(proposal?.sequences.map((s) => s.pattern)).toEqual(['plan.%04d.exr']);
    expect(proposal?.singles.map((s) => s.name)).toEqual(['notes.txt']);
    expect(enqueue).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });
});

describe('acceptProposal', () => {
  it('envoie la séquence retenue en un seul média, et le reste en fichiers', () => {
    useSequenceUploadStore.getState().proposeDrop([...plan(1001, 1010), file('notes.txt')], 4);
    const { proposal, acceptProposal } = useSequenceUploadStore.getState();
    acceptProposal(proposal!.sequences);

    expect(useSequenceUploadStore.getState().uploads).toHaveLength(1);
    expect(useSequenceUploadStore.getState().uploads[0]).toMatchObject({
      pattern: 'plan.%04d.exr',
      totalFrames: 10,
    });
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ name: 'notes.txt' }), 4);
  });

  it('rend ses frames à la file ordinaire quand la séquence est refusée', () => {
    useSequenceUploadStore.getState().proposeDrop(plan(1001, 1010), 4);
    useSequenceUploadStore.getState().acceptProposal([]);
    expect(useSequenceUploadStore.getState().uploads).toEqual([]);
    expect(enqueue).toHaveBeenCalledTimes(10);
  });

  it('signale une livraison à trous plutôt que de la laisser passer sans un mot', async () => {
    upload.mockResolvedValue({ mediaObjectId: 7, status: 'PROCESSING', frameCount: 9, missingFrames: 1 });
    useSequenceUploadStore.getState().proposeDrop(plan(1001, 1010), 4);
    const { proposal, acceptProposal } = useSequenceUploadStore.getState();
    acceptProposal(proposal!.sequences);
    await vi.waitFor(() => expect(toasts.warning).toHaveBeenCalledTimes(1));
    expect(useSequenceUploadStore.getState().uploads[0].status).toBe('processing');
  });

  it('remonte l’échec sans effacer la ligne : l’artiste doit voir ce qui a raté', async () => {
    upload.mockRejectedValue(new Error('403'));
    useSequenceUploadStore.getState().proposeDrop(plan(1001, 1010), 4);
    const { proposal, acceptProposal } = useSequenceUploadStore.getState();
    acceptProposal(proposal!.sequences);
    await vi.waitFor(() => expect(useSequenceUploadStore.getState().uploads[0].status).toBe('error'));
  });
});

describe('cancelProposal', () => {
  it('referme sans rien envoyer', () => {
    useSequenceUploadStore.getState().proposeDrop(plan(1001, 1010), 4);
    useSequenceUploadStore.getState().cancelProposal();
    expect(useSequenceUploadStore.getState().proposal).toBeNull();
    expect(enqueue).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });
});

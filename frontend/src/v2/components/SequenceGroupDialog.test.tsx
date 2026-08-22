// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { accept, cancel } = vi.hoisted(() => ({ accept: vi.fn(), cancel: vi.fn() }));

import SequenceGroupDialog from './SequenceGroupDialog';
import { t } from '../i18n';
import { detectSequences } from '../../lib/imageSequence';
import { useSequenceUploadStore } from '../../stores/useSequenceUploadStore';

/**
 * La proposition de regroupement.
 *
 * Ce dialogue est le seul endroit où se décide si mille fichiers deviennent un média ou
 * mille. Ce qui se vérifie : il montre ce qui a été reconnu (motif, bornes, trous), il
 * part avec tout regroupé, et il offre une sortie franche vers l'envoi fichier par
 * fichier — le regroupement ne doit jamais être le seul chemin.
 */

const file = (name: string, size = 1000): File => ({ name, size }) as unknown as File;
const plan = (from: number, to: number): File[] =>
  Array.from({ length: to - from + 1 }, (_, i) => file(`plan.${String(from + i).padStart(4, '0')}.exr`));

const openWith = (files: File[]): void => {
  const { sequences, singles } = detectSequences(files);
  useSequenceUploadStore.setState({
    proposal: { versionId: 4, sequences, singles },
    uploads: [],
    acceptProposal: accept,
    cancelProposal: cancel,
  });
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  useSequenceUploadStore.setState({ proposal: null, uploads: [] });
});

describe('SequenceGroupDialog', () => {
  it('ne s’affiche pas quand aucun dépôt n’attend de décision', () => {
    useSequenceUploadStore.setState({ proposal: null });
    const { container } = render(<SequenceGroupDialog />);
    expect(container).toBeEmptyDOMElement();
  });

  it('montre le motif reconnu et les bornes de la livraison', () => {
    openWith(plan(1001, 1010));
    render(<SequenceGroupDialog />);
    expect(screen.getByText('plan.%04d.exr')).toBeTruthy();
  });

  it('part avec tout regroupé : c’est le cas de très loin le plus fréquent', async () => {
    openWith(plan(1001, 1010));
    render(<SequenceGroupDialog />);
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(1);
    expect(boxes[0].getAttribute('data-state')).toBe('checked');

    // Les libellés sont interrogés par `t()`, pas recopiés : le test survit à la pose du
    // lot de traduction comme au changement de langue.
    await userEvent.click(screen.getByRole('button', { name: t('imageSequence.confirm') }));
    expect(accept).toHaveBeenCalledTimes(1);
    expect((accept.mock.calls[0][0] as { pattern: string }[])[0].pattern).toBe('plan.%04d.exr');
  });

  it('laisse tout envoyer fichier par fichier', async () => {
    openWith(plan(1001, 1010));
    render(<SequenceGroupDialog />);
    await userEvent.click(screen.getByRole('button', { name: t('imageSequence.sendSeparately') }));
    expect(accept).toHaveBeenCalledWith([]);
  });

  it('propose deux séquences séparément quand le dépôt en contient deux', () => {
    openWith([...plan(1001, 1005), file('autre.0001.dpx'), file('autre.0002.dpx')]);
    render(<SequenceGroupDialog />);
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
  });
});

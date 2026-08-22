// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import LivePointers from './LivePointers';
import { clearPointers, receivePointer } from './pointerBus';

afterEach(() => clearPointers());

describe('LivePointers', () => {
  it('personne ne montre rien : aucun calque au-dessus de l’image', () => {
    const { container } = render(<LivePointers />);
    expect(container).toBeEmptyDOMElement();
  });

  it('place chaque curseur en fraction du cadre, avec le nom de son auteur', () => {
    const { container } = render(<LivePointers />);
    act(() => receivePointer({ userId: 3, x: 0.25, y: 0.5 }, 'Ada Lovelace'));
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    const cursor = container.querySelector<HTMLElement>('[style*="left"]')!;
    expect(cursor.style.left).toBe('25%');
    expect(cursor.style.top).toBe('50%');
  });

  it('suit les déplacements et le départ d’un participant', () => {
    render(<LivePointers />);
    act(() => receivePointer({ userId: 3, x: 0.1, y: 0.1 }, 'Ada'));
    act(() => receivePointer({ userId: 3, x: 0.8, y: 0.2 }, 'Ada'));
    expect(screen.getAllByText('Ada')).toHaveLength(1);
    act(() => receivePointer({ userId: 3, x: 0, y: 0, gone: true }, 'Ada'));
    expect(screen.queryByText('Ada')).toBeNull();
  });
});

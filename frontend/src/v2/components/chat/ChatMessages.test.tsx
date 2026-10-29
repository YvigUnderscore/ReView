// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/renderWithProviders';
import { httpError, noContent } from '@/test/apiMock';
import { useChat } from '../../stores/useChat';
import type { ChatMessage } from '../../types/chat';
import { t } from '../../i18n';
import ChatMessages from './ChatMessages';

const message = (id: number, authorId: number, body: string): ChatMessage => ({
  id,
  conversationId: 7,
  isSystem: false,
  createdAt: '2026-09-01T10:00:00.000Z',
  editedAt: null,
  author: { id: authorId, displayName: `User ${authorId}`, initials: 'U', avatarUrl: null },
  body,
  systemKey: null,
  systemVars: null,
});

beforeEach(() => {
  useChat.setState({
    messages: { 7: [message(1, 2, 'hello'), message(2, 1, 'mine')] },
    atStart: { 7: true },
  });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());
// Let sonner's removal timers run out before the environment is torn down.
afterAll(() => new Promise<void>((resolve) => setTimeout(resolve, 300)));

describe('ChatMessages — deleting my message', () => {
  it('offers deletion on my messages only', () => {
    renderWithProviders(<ChatMessages conversationId={7} selfId={1} />);
    expect(screen.getAllByTitle(t('chat.delete'))).toHaveLength(1);
  });

  it('sends the deletion', async () => {
    const { user, api } = renderWithProviders(<ChatMessages conversationId={7} selfId={1} />, {
      api: { 'DELETE /api/chat/messages/:id': noContent() },
    });
    await user.click(screen.getByTitle(t('chat.delete')));
    await vi.waitFor(() =>
      expect(api.calls.some((c) => c.method === 'DELETE' && c.path === '/api/chat/messages/2')).toBe(true),
    );
  });

  it('says so when the server refuses, instead of failing silently', async () => {
    const { user } = renderWithProviders(<ChatMessages conversationId={7} selfId={1} />, {
      api: { 'DELETE /api/chat/messages/:id': httpError(403, 'Not your message') },
    });
    await user.click(screen.getByTitle(t('chat.delete')));
    expect(await screen.findByText('Not your message')).toBeInTheDocument();
    expect(console.error).toHaveBeenCalled();
  });
});

// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { toast } from 'sonner';
import { Bell, BellOff, LogOut, Pencil, UserPlus, X } from 'lucide-react';
import { api } from '../../../lib/apiClient';
import { useAuth } from '../../stores/useAuth';
import { useChat, conversationLabel } from '../../stores/useChat';
import Avatar from '../Avatar';
import ChatMessages from './ChatMessages';
import PeoplePicker from './PeoplePicker';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { useT } from '../../i18n';

/**
 * Fenêtre de conversation, ancrée au-dessus du pied de sidebar — la messagerie suit la
 * navigation au lieu d'occuper une page : on écrit à quelqu'un sans quitter sa review.
 */
export default function ChatDock({ sidebarHidden }: { sidebarHidden: boolean }) {
  const t = useT();
  const self = useAuth((s) => s.user);
  const openId = useChat((s) => s.openId);
  const conversation = useChat((s) => s.conversations.find((c) => c.id === s.openId) ?? null);
  const close = useChat((s) => s.close);
  const send = useChat((s) => s.send);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [inviting, setInviting] = useState(false);

  if (!openId || !conversation || !self) return null;

  const label = conversationLabel(conversation, self.id, t('chat.you'));
  const others = conversation.members.filter((m) => m.id !== self.id);

  const submit = async () => {
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      await send(conversation.id, body);
      setDraft('');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('common.error.generic'));
    } finally {
      setBusy(false);
    }
  };

  const toggleMute = async () => {
    try {
      await api.patch(`/api/chat/conversations/${conversation.id}`, { muted: !conversation.muted });
      await useChat.getState().reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('common.error.generic'));
    }
  };

  const leave = async () => {
    if (!window.confirm(t('chat.leave.confirm'))) return;
    try {
      await useChat.getState().leave(conversation.id, self.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('common.error.generic'));
    }
  };

  return (
    <div
      className={`fixed bottom-4 z-40 flex h-96 w-80 flex-col rounded-lg border border-border bg-card shadow-xl ${
        sidebarHidden ? 'left-4' : 'left-[15.5rem]'
      }`}
    >
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        {others[0] && (
          <Avatar
            seed={others[0].id}
            initials={conversation.isGroup ? `${others.length + 1}` : others[0].initials}
            avatarUrl={conversation.isGroup ? null : others[0].avatarUrl}
            size={26}
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{label}</div>
          {conversation.isGroup && (
            <div className="truncate text-2xs text-muted-foreground">
              {t('chat.group.members', { count: conversation.members.length })}
            </div>
          )}
        </div>
        <HeaderButton title={t('chat.addMembers')} onClick={() => setInviting(true)}>
          <UserPlus size={14} />
        </HeaderButton>
        {conversation.isGroup && (
          <HeaderButton title={t('chat.rename')} onClick={() => setRenaming(true)}>
            <Pencil size={14} />
          </HeaderButton>
        )}
        <HeaderButton
          title={conversation.muted ? t('chat.unmute') : t('chat.mute')}
          onClick={() => void toggleMute()}
        >
          {conversation.muted ? <BellOff size={14} /> : <Bell size={14} />}
        </HeaderButton>
        {conversation.isGroup && (
          <HeaderButton title={t('chat.leave')} onClick={() => void leave()}>
            <LogOut size={14} />
          </HeaderButton>
        )}
        <HeaderButton title={t('common.close')} onClick={close}>
          <X size={15} />
        </HeaderButton>
      </header>

      <ChatMessages conversationId={conversation.id} selfId={self.id} />

      <div className="border-t border-border p-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Entrée envoie, Maj+Entrée passe à la ligne : la convention de toutes les
            // messageries, et le seul moyen d'écrire vite sans viser un bouton.
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
          rows={2}
          maxLength={4000}
          placeholder={t('chat.placeholder')}
          className="w-full resize-none rounded-md border border-input bg-background px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      {/* `key` : le champ repart du titre courant si le groupe a été renommé entre-temps. */}
      <RenameDialog
        key={conversation.title ?? ''}
        open={renaming}
        onOpenChange={setRenaming}
        current={conversation.title ?? ''}
        onSubmit={(title) => useChat.getState().rename(conversation.id, title)}
      />
      {/* Monté à l'ouverture seulement : le sélecteur lit l'annuaire de présence, inutile
          d'en tenir un second abonnement ouvert derrière chaque fenêtre de conversation. */}
      {inviting && (
        <PeoplePicker
          open
          onOpenChange={setInviting}
          title={t('chat.addMembers')}
          excludeIds={conversation.members.map((m) => m.id)}
          onSubmit={(ids) => useChat.getState().addMembers(conversation.id, ids)}
        />
      )}
    </div>
  );
}

function HeaderButton({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      title={title}
      aria-label={title}
      onClick={onClick}
      className="shrink-0 rounded p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
    >
      {children}
    </button>
  );
}

function RenameDialog({
  open,
  onOpenChange,
  current,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  current: string;
  onSubmit: (title: string) => Promise<void>;
}) {
  const t = useT();
  const [title, setTitle] = useState(current);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('chat.rename')}</DialogTitle>
        </DialogHeader>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={120}
          placeholder={t('chat.group.namePlaceholder')}
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={!title.trim()}
            onClick={() =>
              void onSubmit(title)
                .then(() => onOpenChange(false))
                .catch((e: unknown) =>
                  toast.error(e instanceof Error ? e.message : t('common.error.generic')),
                )
            }
          >
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

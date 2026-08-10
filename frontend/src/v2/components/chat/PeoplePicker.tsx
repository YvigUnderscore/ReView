// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Check } from 'lucide-react';
import { usePresence } from '../../stores/usePresence';
import { useAuth } from '../../stores/useAuth';
import Avatar from '../Avatar';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { useT } from '../../i18n';

/**
 * Choix de destinataires dans l'annuaire du studio — sert aussi bien à ouvrir un groupe
 * qu'à inviter du monde dans un fil existant. Le champ `title` (nom du groupe) n'apparaît
 * que sur demande : un tête-à-tête n'a pas de nom.
 */
export default function PeoplePicker({
  open,
  onOpenChange,
  title,
  excludeIds = [],
  withGroupName = false,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  excludeIds?: number[];
  withGroupName?: boolean;
  onSubmit: (userIds: number[], groupName: string) => Promise<void>;
}) {
  const t = useT();
  const self = useAuth((s) => s.user);
  const { users } = usePresence();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<number[]>([]);
  const [groupName, setGroupName] = useState('');
  const [busy, setBusy] = useState(false);

  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users
      .filter((u) => u.id !== self?.id && !excludeIds.includes(u.id))
      .filter((u) => !q || u.displayName.toLowerCase().includes(q));
    // `excludeIds` est un littéral recréé à chaque rendu : le comparer par contenu
    // éviterait un recalcul, mais la liste tient en quelques dizaines de personnes.
  }, [users, self?.id, excludeIds, query]);

  const submit = async () => {
    if (selected.length === 0) return;
    setBusy(true);
    try {
      await onSubmit(selected, groupName);
      setSelected([]);
      setGroupName('');
      setQuery('');
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('common.error.generic'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {withGroupName && (
          <Input
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            maxLength={120}
            placeholder={t('chat.group.namePlaceholder')}
            className="mb-2"
          />
        )}
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('chat.search')}
          className="mb-2"
        />
        <div className="custom-scrollbar max-h-64 space-y-0.5 overflow-y-auto">
          {candidates.length === 0 && (
            <p className="px-2 py-4 text-center text-xs text-muted-foreground">{t('chat.search.empty')}</p>
          )}
          {candidates.map((u) => {
            const on = selected.includes(u.id);
            return (
              <button
                key={u.id}
                onClick={() => setSelected((s) => (on ? s.filter((id) => id !== u.id) : [...s, u.id]))}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${
                  on ? 'bg-secondary' : 'hover:bg-secondary/60'
                }`}
              >
                <Avatar
                  seed={u.id}
                  initials={u.initials}
                  avatarUrl={u.avatarUrl}
                  size={24}
                  status={u.status}
                  online={u.online}
                />
                <span className="min-w-0 flex-1 truncate text-sm">{u.displayName}</span>
                {on && <Check size={14} className="shrink-0 text-primary" />}
              </button>
            );
          })}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button disabled={selected.length === 0 || busy} onClick={() => void submit()}>
            {t('common.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

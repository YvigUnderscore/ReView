// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { toast } from 'sonner';
import { KeyRound, Mail } from 'lucide-react';
import { api } from '../../../lib/apiClient';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Select } from '../../components/ui/select';
import { SegmentedControl } from '../../components/ui/segmented-control';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { ROLES } from './adminShared';
import type { Role, User } from '../../types/api';
import { useT } from '../../i18n';

/** Création / édition d'un utilisateur (dialog). */
export default function UserModal({
  title,
  user,
  onClose,
  onSaved,
}: {
  title: string;
  user?: User;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const isEdit = !!user;
  /**
   * À la création, deux façons d'ouvrir un compte : envoyer une invitation (la personne
   * choisit son mot de passe depuis le lien reçu) ou en poser un soi-même. L'invitation est
   * le défaut — un mot de passe transmis de la main à la main n'est jamais changé ensuite.
   */
  const [invite, setInvite] = useState(true);
  const [form, setForm] = useState({
    email: user?.email ?? '',
    password: '',
    firstName: user?.firstName ?? '',
    lastName: user?.lastName ?? '',
    username: user?.username ?? '',
    role: user?.role ?? 'ARTIST',
    storageLimitGo: user?.storageLimit ? String((user.storageLimit / 1e9).toFixed(0)) : '',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        email: form.email,
        firstName: form.firstName || null,
        lastName: form.lastName || null,
        username: form.username || null,
        role: form.role,
      };
      // En mode invitation, aucun mot de passe ne part au serveur : c'est son absence qui
      // déclenche l'envoi du lien.
      if (form.password && (isEdit || !invite)) body.password = form.password;
      if (form.storageLimitGo) body.storageLimit = Math.round(Number(form.storageLimitGo) * 1e9);
      if (isEdit) {
        await api.patch(`/api/users/${user.id}`, body);
        toast.success(t('userModal.updated'));
      } else {
        if (!invite && !form.password) throw new Error(t('userModal.passwordRequired'));
        await api.post('/api/users', body);
        toast.success(invite ? t('userModal.invited') : t('userModal.created'));
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error.generic'));
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent>
        <form onSubmit={submit} className="space-y-3">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2">
            <Input
              placeholder={t('profile.firstName')}
              value={form.firstName}
              onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
            />
            <Input
              placeholder={t('common.name')}
              value={form.lastName}
              onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
            />
          </div>
          <Input
            placeholder={t('userModal.username')}
            value={form.username}
            onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
          />
          <Input
            type="email"
            placeholder={t('login.email')}
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            required
          />
          {!isEdit && (
            <div className="space-y-2 rounded-md border border-border p-3">
              <SegmentedControl
                label={t('userModal.accessLabel')}
                value={invite ? 'invite' : 'password'}
                onChange={(v) => setInvite(v === 'invite')}
                items={[
                  { value: 'invite', label: t('userModal.byInvitation'), icon: Mail },
                  { value: 'password', label: t('userModal.byPassword'), icon: KeyRound },
                ]}
                className="w-full"
              />
              {invite ? (
                <p className="text-xs text-muted-foreground">{t('userModal.inviteHint')}</p>
              ) : (
                <Input
                  type="password"
                  placeholder={t('user.passwordRule')}
                  value={form.password}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                  required
                />
              )}
            </div>
          )}
          {isEdit && (
            <Input
              type="password"
              placeholder={t('user.newPassword')}
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            />
          )}
          <div className="grid grid-cols-2 gap-2">
            <Select
              className="w-full"
              value={form.role}
              onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as Role }))}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
            <Input
              type="number"
              placeholder={t('storage.quotaLabel')}
              value={form.storageLimitGo}
              onChange={(e) => setForm((f) => ({ ...f, storageLimitGo: e.target.value }))}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              {t('common.undo')}
            </Button>
            <Button type="submit" size="sm" disabled={busy}>
              {isEdit ? t('common.save') : t('common.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

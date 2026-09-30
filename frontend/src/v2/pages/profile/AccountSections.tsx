// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useRef, useState } from 'react';
import { KeyRound, UserRound, Image as ImageIcon } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { useAuth, type AuthUser } from '../../stores/useAuth';
import Avatar from '../../components/Avatar';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Field } from '../../components/ui/field';
import { Label } from '../../components/ui/label';
import { Hint } from '../../components/ui/hint';
import { SettingsCard } from '../../components/settings/SettingsCard';
import { SETTINGS_KEYWORDS } from '../../components/settings/settingsKeywords';
import { useT } from '../../i18n';

/**
 * Le compte lui-même : portrait, état civil, mot de passe.
 *
 * Les trois vivaient dans `ProfilePage`, qui frôlait son budget de lignes et mêlait la
 * composition de la page à trois appels réseau. Ils partagent un état — le mot de passe
 * actuel, que le serveur réclame pour changer l'email **et** pour changer le mot de passe
 * (un jeton volé ne doit pas suffire à verrouiller le compte) — et restent donc ensemble.
 */
export default function AccountSections() {
  const t = useT();
  const user = useAuth((s) => s.user);
  const setUser = useAuth((s) => s.setUser);
  const fileRef = useRef<HTMLInputElement>(null);
  const [vals, setVals] = useState({
    firstName: user?.firstName ?? '',
    lastName: user?.lastName ?? '',
    username: user?.username ?? '',
    email: user?.email ?? '',
    jobTitle: user?.jobTitle ?? '',
    bio: user?.bio ?? '',
    phone: user?.phone ?? '',
  });
  const [pwd, setPwd] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [busy, setBusy] = useState(false);

  if (!user) return null;

  const saveProfile = async () => {
    setBusy(true);
    try {
      const body: Record<string, string> = {};
      if (vals.firstName !== (user.firstName ?? '')) body.firstName = vals.firstName;
      if (vals.lastName !== (user.lastName ?? '')) body.lastName = vals.lastName;
      if (vals.username !== (user.username ?? '')) body.username = vals.username;
      if (vals.jobTitle !== (user.jobTitle ?? '')) body.jobTitle = vals.jobTitle;
      if (vals.bio !== (user.bio ?? '')) body.bio = vals.bio;
      if (vals.phone !== (user.phone ?? '')) body.phone = vals.phone;
      if (vals.email !== user.email) {
        if (!currentPassword) {
          toast.error(t('profile.password.currentRequired'));
          return;
        }
        body.email = vals.email;
        body.currentPassword = currentPassword;
      }
      const { user: updated } = await api.patch<{ user: AuthUser }>('/api/users/me', body);
      setUser(updated);
      setCurrentPassword('');
      toast.success(t('profile.updated'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('common.error.generic'));
    } finally {
      setBusy(false);
    }
  };

  const savePassword = async () => {
    if (pwd.length < 8) {
      toast.error(t('profile.password.tooShort'));
      return;
    }
    if (!currentPassword) {
      toast.error(t('profile.password.currentRequired'));
      return;
    }
    setBusy(true);
    try {
      const { user: updated } = await api.patch<{ user: AuthUser }>('/api/users/me', {
        password: pwd,
        currentPassword,
      });
      setUser(updated);
      setPwd('');
      setCurrentPassword('');
      toast.success(t('profile.password.updated'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('common.error.generic'));
    } finally {
      setBusy(false);
    }
  };

  const onAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = '';
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) {
      toast.error(t('profile.avatar.invalidFormat'));
      return;
    }
    setBusy(true);
    try {
      const { url, key } = await api.post<{ url: string; key: string }>('/api/users/me/avatar/presign', {
        contentType: file.type,
      });
      const put = await fetch(url, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
      if (!put.ok) throw new Error(t('profile.avatar.uploadFailed'));
      const { user: updated } = await api.put<{ user: AuthUser }>('/api/users/me/avatar', { key });
      setUser(updated);
      toast.success(t('profile.avatar.updated'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error.generic'));
    } finally {
      setBusy(false);
    }
  };

  const removeAvatar = async () => {
    setBusy(true);
    try {
      const { user: updated } = await api.put<{ user: AuthUser }>('/api/users/me/avatar', { key: null });
      setUser(updated);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error.generic'));
    } finally {
      setBusy(false);
    }
  };

  const set = (k: keyof typeof vals) => (v: string) => setVals((s) => ({ ...s, [k]: v }));

  return (
    <>
      <SettingsCard
        title={t('profile.avatar.title')}
        icon={ImageIcon}
        tone="accent"
        keywords={SETTINGS_KEYWORDS.avatar}
        footnote={t('profile.avatar.formats')}
      >
        <div className="flex items-center gap-4">
          <Avatar
            seed={user.id}
            initials={user.initials ?? user.email.slice(0, 2).toUpperCase()}
            avatarUrl={user.avatarUrl}
            size={64}
          />
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={onAvatar}
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={() => fileRef.current?.click()} disabled={busy}>
              {t('profile.avatar.change')}
            </Button>
            {user.avatarUrl && (
              <Button size="sm" variant="outline" onClick={removeAvatar} disabled={busy}>
                {t('profile.avatar.remove')}
              </Button>
            )}
          </div>
        </div>
      </SettingsCard>

      <SettingsCard
        title={t('profile.identity')}
        icon={UserRound}
        tone="primary"
        keywords={SETTINGS_KEYWORDS.identity}
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('profile.firstName')}>
            <Input value={vals.firstName} onChange={(e) => set('firstName')(e.target.value)} />
          </Field>
          <Field label={t('profile.lastName')}>
            <Input value={vals.lastName} onChange={(e) => set('lastName')(e.target.value)} />
          </Field>
          <Field label={t('profile.username')}>
            <Input
              value={vals.username}
              placeholder={t('profile.username.placeholder')}
              onChange={(e) => set('username')(e.target.value)}
            />
          </Field>
          <Field label={t('login.email')}>
            <Input type="email" value={vals.email} onChange={(e) => set('email')(e.target.value)} />
          </Field>
          <Field label={t('profile.jobTitle')}>
            <Input
              value={vals.jobTitle}
              placeholder={t('profile.jobTitle.placeholder')}
              onChange={(e) => set('jobTitle')(e.target.value)}
            />
          </Field>
          <Field label={t('profile.phone')}>
            <Input
              value={vals.phone}
              placeholder={t('profile.phone.placeholder')}
              onChange={(e) => set('phone')(e.target.value)}
            />
          </Field>
        </div>
        <div>
          <Label className="mb-1 block text-xs text-muted-foreground" htmlFor="profile-bio">
            {t('profile.bio')}
          </Label>
          <textarea
            id="profile-bio"
            value={vals.bio}
            onChange={(e) => set('bio')(e.target.value)}
            maxLength={500}
            rows={3}
            placeholder={t('profile.bio.placeholder')}
            className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <Button onClick={saveProfile} disabled={busy}>
          {t('common.save')}
        </Button>
      </SettingsCard>

      <SettingsCard
        title={t('profile.password.section')}
        icon={KeyRound}
        tone="warning"
        keywords={SETTINGS_KEYWORDS.password}
      >
        {/* Exigé par le serveur pour changer le mot de passe ET pour changer l'email. */}
        <Field label={t('profile.password.current')}>
          <Input
            type="password"
            value={currentPassword}
            placeholder={t('profile.password.currentPlaceholder')}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
        </Field>
        <Field label={t('profile.password.new')} hint={t('profile.password.placeholder')}>
          <Input type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} />
        </Field>
        {pwd.length > 0 && pwd.length < 8 && <Hint tone="error">{t('profile.password.tooShort')}</Hint>}
        <Button onClick={savePassword} disabled={busy || !pwd || !currentPassword}>
          {t('profile.password.submit')}
        </Button>
      </SettingsCard>
    </>
  );
}

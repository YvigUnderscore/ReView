// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { MailCheck } from 'lucide-react';
import { api } from '../../lib/apiClient';
import { useAuth } from '../stores/useAuth';
import { useT } from '../i18n';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { AuthLayout } from './auth/AuthLayout';

/**
 * Activation d'un compte créé par invitation (Phase 47) : le lien reçu par email amène ici,
 * la personne choisit son mot de passe et se retrouve connectée. Page publique — le jeton
 * de l'URL est la seule preuve d'identité, il n'y a pas encore de session.
 */
export default function InvitePage() {
  const t = useT();
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const ssoLogin = useAuth((s) => s.ssoLogin);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const invitationQ = useQuery({
    queryKey: ['invitation', token],
    queryFn: () =>
      api.get<{ invitation: { email: string; name: string; invitedBy: string | null } }>(
        `/api/auth/invitation/${token}`,
      ),
    retry: false,
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      setError(t('invite.mismatch'));
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const r = await api.post<{ token: string; refreshToken?: string }>(`/api/auth/invitation/${token}`, {
        password,
      });
      // Le serveur ouvre la session en même temps qu'il pose le mot de passe : on entre
      // directement dans l'application plutôt que de renvoyer sur l'écran de connexion.
      await ssoLogin(r.token, r.refreshToken);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error.generic'));
      setBusy(false);
    }
  };

  if (invitationQ.isPending) {
    return (
      <AuthLayout title={t('invite.pageTitle')} subtitle={t('invite.pageSubtitle')}>
        <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
      </AuthLayout>
    );
  }

  if (invitationQ.isError) {
    return (
      <AuthLayout title={t('invite.pageTitle')} subtitle={t('invite.pageSubtitle')}>
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">{t('invite.invalidTitle')}</h2>
          <p className="text-sm text-muted-foreground">{t('invite.invalidBody')}</p>
          <Link to="/login" className="text-sm text-primary hover:underline">
            {t('login.backToLogin')}
          </Link>
        </div>
      </AuthLayout>
    );
  }

  const invitation = invitationQ.data.invitation;
  return (
    <AuthLayout title={t('invite.pageTitle')} subtitle={t('invite.pageSubtitle')}>
      <div className="mb-6">
        <h2 className="flex items-center gap-2 text-xl font-semibold">
          <MailCheck size={20} className="text-primary" /> {t('invite.heading')}
        </h2>
        <p className="text-sm text-muted-foreground">
          {invitation.invitedBy
            ? t('invite.byWho', { inviter: invitation.invitedBy })
            : t('invite.choosePassword')}
        </p>
      </div>
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="invite-email">{t('login.email')}</Label>
          <Input id="invite-email" value={invitation.email} readOnly disabled />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="invite-password">{t('user.newPassword')}</Label>
          <Input
            id="invite-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t('user.passwordRule')}
            autoComplete="new-password"
            autoFocus
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="invite-confirm">{t('invite.confirmPassword')}</Label>
          <Input
            id="invite-confirm"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            required
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" disabled={busy || !password} className="w-full">
          {t('invite.submit')}
        </Button>
      </form>
    </AuthLayout>
  );
}

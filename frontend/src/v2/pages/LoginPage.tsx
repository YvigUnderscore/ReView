// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { api } from '../../lib/apiClient';
import { useAuth } from '../stores/useAuth';
import { t, useT } from '../i18n';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { AuthLayout } from './auth/AuthLayout';

/** Traduit les erreurs techniques en messages humains. */
function humanError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('invalid') || m.includes('incorrect') || m.includes('identifiant'))
    return t('login.error.credentials');
  if (m.includes('network') || m.includes('fetch') || m.includes('failed')) return t('login.error.network');
  return message;
}

export default function LoginPage() {
  const t = useT();
  const tr = useT();
  const login = useAuth((s) => s.login);
  const verify2fa = useAuth((s) => s.verify2fa);
  const ssoLogin = useAuth((s) => s.ssoLogin);
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // Étape 2FA (36.A) : tmpToken présent = on attend le code TOTP/secours.
  const [tmpToken, setTmpToken] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Bouton SSO (36.A) — affiché seulement si l'OIDC est configuré côté studio.
  const ssoQ = useQuery({
    queryKey: ['oidc-status'],
    queryFn: () => api.get<{ enabled: boolean; label: string }>('/api/auth/oidc/status'),
    staleTime: 5 * 60 * 1000,
  });

  // Retours OIDC par fragment : #sso=<access>&refresh=<r> | #tfa=<tmpToken> | #ssoerr=<msg>.
  useEffect(() => {
    if (!window.location.hash) return;
    const params = new URLSearchParams(window.location.hash.slice(1));
    const sso = params.get('sso');
    const tfa = params.get('tfa');
    const ssoerr = params.get('ssoerr');
    window.history.replaceState(null, '', window.location.pathname);
    if (sso) {
      void ssoLogin(sso, params.get('refresh') ?? undefined)
        .then(() => navigate('/'))
        .catch(() => setError('Connexion SSO échouée'));
    } else if (tfa) {
      setTmpToken(tfa);
    } else if (ssoerr) {
      setError(ssoerr);
    }
  }, [navigate, ssoLogin]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const r = await login(email, password);
      if (r.tmpToken) {
        setTmpToken(r.tmpToken);
        return;
      }
      navigate('/');
    } catch (err) {
      setError(humanError(err instanceof Error ? err.message : tr('login.error.generic')));
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await verify2fa(tmpToken!, code);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Code incorrect');
    } finally {
      setBusy(false);
    }
  };

  if (tmpToken) {
    return (
      <AuthLayout title={tr('login.title')} subtitle={tr('login.subtitle')}>
        <div className="mb-6">
          <h2 className="flex items-center gap-2 text-xl font-semibold">
            <ShieldCheck size={20} className="text-primary" /> Vérification en deux étapes
          </h2>
          <p className="text-sm text-muted-foreground">
            Saisissez le code de votre application d'authentification (ou un code de secours).
          </p>
        </div>
        <form onSubmit={submitCode} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="totp">Code</Label>
            <Input
              id="totp"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123 456"
              autoComplete="one-time-code"
              autoFocus
              required
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={busy || !code.trim()} className="w-full">
            Vérifier
          </Button>
          <button
            type="button"
            className="w-full text-center text-xs text-muted-foreground hover:text-foreground"
            onClick={() => {
              setTmpToken(null);
              setCode('');
              setError(null);
            }}
          >
            ← Revenir à la connexion
          </button>
        </form>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title={tr('login.title')} subtitle={tr('login.subtitle')}>
      <div className="mb-6">
        <h2 className="text-xl font-semibold">{tr('login.heading')}</h2>
        <p className="text-sm text-muted-foreground">{tr('login.lead')}</p>
      </div>
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="email">{tr('login.email')}</Label>
          <Input
            id="email"
            type="email"
            placeholder={t('email.placeholder')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">{tr('login.password')}</Label>
          <Input
            id="password"
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? tr('login.submitting') : tr('login.submit')}
        </Button>
        {ssoQ.data?.enabled && (
          <a
            href="/api/auth/oidc/login"
            className="block w-full rounded-md border border-border px-4 py-2 text-center text-sm hover:bg-secondary/60"
          >
            {ssoQ.data.label || t('sso.buttonDefault')}
          </a>
        )}
      </form>
    </AuthLayout>
  );
}

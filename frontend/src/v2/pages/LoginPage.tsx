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

/**
 * Marker "this browser started the SSO flow".
 *
 * The OIDC return arrives in the URL fragment, which anyone can forge: without
 * this guard, `…/login#sso=<attacker's token>` would silently log the victim into the
 * attacker's account (session fixation), which then reads everything she
 * stores there. `sessionStorage` is deliberate: the marker is specific to the tab and disappears
 * when it closes.
 */
const SSO_FLOW_KEY = 'sso_flow_started';

const markSsoFlowStarted = () => {
  try {
    sessionStorage.setItem(SSO_FLOW_KEY, '1');
  } catch {
    /* storage unavailable (strict private browsing): the return will simply be refused */
  }
};

/** Consumes the marker (single use) and says whether it was present. */
const consumeSsoFlowMarker = (): boolean => {
  try {
    const ok = sessionStorage.getItem(SSO_FLOW_KEY) === '1';
    sessionStorage.removeItem(SSO_FLOW_KEY);
    return ok;
  } catch {
    return false;
  }
};

/** Translates technical errors into human messages. */
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
  // 2FA step (36.A): tmpToken present = we are waiting for the TOTP/backup code.
  const [tmpToken, setTmpToken] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // SSO button (36.A): shown only if OIDC is configured on the studio side. `passwordLogin`
  // says whether the studio still accepts the email + password pair ("SSO only" mode).
  const ssoQ = useQuery({
    queryKey: ['oidc-status'],
    queryFn: () =>
      api.get<{ enabled: boolean; label: string; logoUrl: string | null; passwordLogin: boolean }>(
        '/api/auth/oidc/status',
      ),
    staleTime: 5 * 60 * 1000,
  });
  // Until the response arrives, we keep the form: better a useless field
  // for a fraction of a second than an empty sign-in page if the request fails.
  const passwordLogin = ssoQ.data?.passwordLogin !== false;

  // OIDC returns via fragment: #sso=<access>&refresh=<r> | #tfa=<tmpToken> | #ssoerr=<msg>.
  useEffect(() => {
    if (!window.location.hash) return;
    const params = new URLSearchParams(window.location.hash.slice(1));
    const sso = params.get('sso');
    const tfa = params.get('tfa');
    const ssoerr = params.get('ssoerr');
    window.history.replaceState(null, '', window.location.pathname);
    // The fragment proves nothing by itself: accepting a token because it is in
    // the URL would let a third party send `…/login#sso=<THEIR token>` and silently log
    // its victim INTO THE THIRD PARTY'S ACCOUNT — everything she then stores
    // is readable by them. So we only honour the return if THIS browser itself started the
    // SSO flow, a marker set on click and consumed here.
    if ((sso || tfa) && !consumeSsoFlowMarker()) {
      setError(t('login.ssoUnsolicited'));
      return;
    }
    if (sso) {
      void ssoLogin(sso, params.get('refresh') ?? undefined)
        .then(() => navigate('/'))
        .catch(() => setError(t('login.ssoFailed')));
    } else if (tfa) {
      setTmpToken(tfa);
    } else if (ssoerr) {
      setError(ssoerr);
    }
  }, [navigate, ssoLogin, t]);

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
      void navigate('/');
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
      void navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('twofa.wrongCode'));
    } finally {
      setBusy(false);
    }
  };

  if (tmpToken) {
    return (
      <AuthLayout title={tr('login.title')} subtitle={tr('login.subtitle')}>
        <div className="mb-6">
          <h2 className="flex items-center gap-2 text-xl font-semibold">
            <ShieldCheck size={20} className="text-primary" /> {t('twofa.title')}
          </h2>
          <p className="text-sm text-muted-foreground">{t('login.2faPrompt')}</p>
        </div>
        <form onSubmit={submitCode} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="totp">{t('sequences.code.placeholder')}</Label>
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
            {t('common.verify')}
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
            {t('login.backToLogin')}
          </button>
        </form>
      </AuthLayout>
    );
  }

  const ssoButton = ssoQ.data?.enabled ? (
    <a
      href="/api/auth/oidc/login"
      onClick={markSsoFlowStarted}
      className="flex w-full items-center justify-center gap-2 rounded-md border border-border px-4 py-2 text-center text-sm hover:bg-secondary/60"
    >
      {ssoQ.data.logoUrl && (
        <img src={ssoQ.data.logoUrl} alt="" aria-hidden className="h-5 w-5 shrink-0 object-contain" />
      )}
      {ssoQ.data.label || t('sso.buttonDefault')}
    </a>
  ) : null;

  return (
    <AuthLayout title={tr('login.title')} subtitle={tr('login.subtitle')}>
      <div className="mb-6">
        <h2 className="text-xl font-semibold">{tr('login.heading')}</h2>
        <p className="text-sm text-muted-foreground">
          {passwordLogin ? tr('login.lead') : tr('login.ssoOnlyLead')}
        </p>
      </div>
      {passwordLogin ? (
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
          {ssoButton}
        </form>
      ) : (
        // "SSO only" mode: the form disappears, the server refusing the email + password
        // pair anyway (`PASSWORD_LOGIN_DISABLED`).
        <div className="space-y-4">
          {error && <p className="text-sm text-destructive">{error}</p>}
          {ssoButton}
          <p className="text-center text-xs text-muted-foreground">{t('login.ssoOnlyHint')}</p>
        </div>
      )}
    </AuthLayout>
  );
}

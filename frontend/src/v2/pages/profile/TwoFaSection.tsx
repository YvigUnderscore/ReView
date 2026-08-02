// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import QRCode from 'qrcode';
import { ShieldCheck, ShieldOff } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { useAuth, type AuthUser } from '../../stores/useAuth';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { useT } from '../../i18n';

/**
 * 2FA TOTP (36.A) : enrôlement (QR + code), codes de secours affichés une fois,
 * désactivation par mot de passe. L'état vient de /api/auth/me (twoFaEnabled).
 */
export default function TwoFaSection() {
  const t = useT();
  const user = useAuth((s) => s.user);
  const setUser = useAuth((s) => s.setUser);
  const [qr, setQr] = useState<string | null>(null);
  const [manualSecret, setManualSecret] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const enabled = user?.twoFaEnabled === true;

  const start = async () => {
    setBusy(true);
    try {
      const { otpauth, secret } = await api.post<{ otpauth: string; secret: string }>('/api/auth/2fa/setup');
      setQr(await QRCode.toDataURL(otpauth, { margin: 1, width: 180 }));
      setManualSecret(secret);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setBusy(false);
    }
  };

  const enable = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { backupCodes: codes } = await api.post<{ backupCodes: string[] }>('/api/auth/2fa/enable', {
        code,
      });
      setBackupCodes(codes);
      setQr(null);
      setManualSecret(null);
      setCode('');
      if (user) setUser({ ...user, twoFaEnabled: true } as AuthUser);
      toast.success(t('twofa.enabled'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('twofa.wrongCode'));
    } finally {
      setBusy(false);
    }
  };

  const disable = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post('/api/auth/2fa/disable', { password });
      setPassword('');
      setBackupCodes(null);
      if (user) setUser({ ...user, twoFaEnabled: false } as AuthUser);
      toast.success(t('twofa.disabled'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        {enabled ? (
          <ShieldCheck size={15} className="text-success" />
        ) : (
          <ShieldOff size={15} className="text-muted-foreground" />
        )}
        Vérification en deux étapes (2FA)
      </h2>

      {backupCodes && (
        <div className="rounded-md border border-warning/40 bg-warning/10 p-3">
          <p className="mb-2 text-xs font-medium">{t('twofa.backupCodes')}</p>
          <div className="grid grid-cols-2 gap-1 font-mono text-xs">
            {backupCodes.map((c) => (
              <code key={c}>{c}</code>
            ))}
          </div>
        </div>
      )}

      {!enabled && !qr && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">{t('twofa.intro')}</p>
          <Button size="sm" onClick={start} disabled={busy}>
            {t('twofa.enable')}
          </Button>
        </div>
      )}

      {!enabled && qr && (
        <form onSubmit={enable} className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Scannez ce QR code avec votre application (Google Authenticator, 1Password…), puis saisissez le
            code affiché.
          </p>
          <div className="flex items-start gap-4">
            <img src={qr} alt="QR code d'enrôlement 2FA" className="rounded-md border border-border" />
            <div className="min-w-0 space-y-2">
              {manualSecret && (
                <p className="break-all text-xs text-muted-foreground">
                  Saisie manuelle : <code>{manualSecret}</code>
                </p>
              )}
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder={t('twofa.code')}
                autoComplete="one-time-code"
                required
              />
              <Button type="submit" size="sm" disabled={busy || !code.trim()}>
                {t('twofa.confirm')}
              </Button>
            </div>
          </div>
        </form>
      )}

      {enabled && (
        <form onSubmit={disable} className="flex items-center gap-2">
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t('twofa.passwordToDisable')}
            className="flex-1"
            required
          />
          <Button type="submit" size="sm" variant="outline" disabled={busy || !password}>
            {t('common.disable')}
          </Button>
        </form>
      )}
    </section>
  );
}

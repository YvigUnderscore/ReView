// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Save, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { SkeletonRows } from '../../components/ui/skeleton';
import { Panel } from './AdminPrimitives';
import { useT } from '../../i18n';

interface OidcView {
  enabled: boolean;
  issuer: string;
  clientId: string;
  hasSecret: boolean;
  publicUrl: string;
  autoProvision: boolean;
  buttonLabel: string;
  passwordLoginDisabled: boolean;
  logoKey: string;
  logoUrl: string | null;
}

type Draft = OidcView & { clientSecret: string };

/** Le serveur refuse de couper le mot de passe tant que le SSO n'est pas complet. */
const ssoReady = (d: Draft) =>
  d.enabled && !!d.clientId.trim() && (d.hasSecret || !!d.clientSecret) && !!d.publicUrl.trim();

/** Section « Identité (SSO) » (36.A) : connexion OIDC (Google par défaut). */
export default function IdentityTab() {
  const t = useT();
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: qk.admin('oidc'),
    queryFn: () => api.get<{ oidc: OidcView }>('/api/admin/oidc').then((d) => d.oidc),
  });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  if (data && !draft) setDraft({ ...data, clientSecret: '' });
  if (!draft) return <SkeletonRows count={4} />;

  const set = (patch: Partial<Draft>) => setDraft((d) => d && { ...d, ...patch });

  const save = async (patch: Partial<OidcView> = {}) => {
    setBusy(true);
    try {
      const { oidc } = await api.put<{ oidc: OidcView }>('/api/admin/oidc', {
        enabled: draft.enabled,
        issuer: draft.issuer,
        clientId: draft.clientId,
        publicUrl: draft.publicUrl,
        autoProvision: draft.autoProvision,
        buttonLabel: draft.buttonLabel,
        passwordLoginDisabled: draft.passwordLoginDisabled,
        logoKey: draft.logoKey,
        // Write-only : envoyé seulement si ressaisi.
        ...(draft.clientSecret ? { clientSecret: draft.clientSecret } : {}),
        ...patch,
      });
      setDraft({ ...oidc, clientSecret: '' });
      qc.invalidateQueries({ queryKey: qk.admin('oidc') });
      toast.success(t('sso.saved'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error.generic'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-4">
      <Panel title={t('sso.oidcTitle')}>
        <p className="mb-3 text-xs text-muted-foreground">
          {t('identity.hint')} <code>{draft.publicUrl || '<URL publique>'}/api/auth/oidc/callback</code>
        </p>
        <div className="space-y-2.5">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="accent-primary"
              checked={draft.enabled}
              onChange={(e) => set({ enabled: e.target.checked })}
            />
            <span className="font-medium">{t('sso.enable')}</span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="accent-primary"
              checked={draft.autoProvision}
              onChange={(e) => set({ autoProvision: e.target.checked })}
            />
            <span className="font-medium">{t('sso.autoCreate')}</span>
            <span className="text-xs text-muted-foreground">{t('identity.unknownEmail')}</span>
          </label>
          <Field
            label={t('sso.appUrl')}
            value={draft.publicUrl}
            onChange={(v) => set({ publicUrl: v })}
            placeholder="https://review.studio.com"
          />
          <Field
            label={t('sso.issuer')}
            value={draft.issuer}
            onChange={(v) => set({ issuer: v })}
            placeholder="https://accounts.google.com"
          />
          <Field
            label={t('sso.clientId')}
            value={draft.clientId}
            onChange={(v) => set({ clientId: v })}
            placeholder="xxxxx.apps.googleusercontent.com"
          />
          <Field
            label={`${t('sso.clientSecret')} ${draft.hasSecret ? t('identity.setKeep') : ''}`}
            value={draft.clientSecret}
            onChange={(v) => set({ clientSecret: v })}
            type="password"
            placeholder={draft.hasSecret ? '••••••••' : 'GOCSPX-…'}
          />
          <Field
            label={t('sso.buttonLabel')}
            value={draft.buttonLabel}
            onChange={(v) => set({ buttonLabel: v })}
            placeholder={t('sso.buttonDefault')}
          />
        </div>
        <div className="mt-3">
          <Button size="sm" onClick={() => void save()} disabled={busy}>
            <Save size={14} className="mr-1" /> {t('common.save')}
          </Button>
        </div>
      </Panel>

      <LogoPanel draft={draft} busy={busy} onSaved={(logoKey) => void save({ logoKey })} />

      <Panel title={t('sso.passwordTitle')}>
        <p className="mb-3 text-xs text-muted-foreground">{t('sso.passwordHint')}</p>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1 accent-primary"
            checked={draft.passwordLoginDisabled}
            disabled={busy || (!draft.passwordLoginDisabled && !ssoReady(draft))}
            // Pas d'optimisme ici : le serveur refuse de couper le mot de passe si le SSO
            // n'est pas complet, et une case cochée à tort ferait croire l'inverse.
            onChange={(e) => void save({ passwordLoginDisabled: e.target.checked })}
          />
          <span>
            <span className="font-medium">{t('sso.passwordDisable')}</span>
            <span className="block text-xs text-muted-foreground">{t('sso.passwordDisableHint')}</span>
          </span>
        </label>
        {!ssoReady(draft) && !draft.passwordLoginDisabled && (
          <p className="mt-2 text-xs text-muted-foreground">{t('sso.passwordNeedsSso')}</p>
        )}
        {draft.passwordLoginDisabled && (
          <p className="mt-2 flex items-start gap-1.5 text-xs text-warning">
            <AlertTriangle size={14} className="mt-px shrink-0" />
            {t('sso.passwordDisabledWarning')}
          </p>
        )}
      </Panel>
    </div>
  );
}

/** Logo affiché dans le bouton SSO de la page de connexion (dépôt MinIO + clé en config). */
function LogoPanel({
  draft,
  busy,
  onSaved,
}: {
  draft: Draft;
  busy: boolean;
  onSaved: (logoKey: string) => void;
}) {
  const t = useT();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = '';
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) {
      toast.error(t('profile.avatar.invalidFormat'));
      return;
    }
    setUploading(true);
    try {
      const { url, key } = await api.post<{ url: string; key: string }>('/api/admin/oidc/logo/presign', {
        contentType: file.type,
      });
      const put = await fetch(url, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
      if (!put.ok) throw new Error(t('profile.avatar.uploadFailed'));
      onSaved(key);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error.generic'));
    } finally {
      setUploading(false);
    }
  };

  const disabled = busy || uploading;
  return (
    <Panel title={t('sso.logoTitle')}>
      <p className="mb-3 text-xs text-muted-foreground">{t('sso.logoHint')}</p>
      <div className="flex items-center gap-4">
        <div className="flex h-16 w-40 items-center justify-center overflow-hidden rounded-md border border-border bg-background">
          {draft.logoUrl ? (
            <img src={draft.logoUrl} alt={t('sso.logoTitle')} className="max-h-full max-w-full object-contain" />
          ) : (
            <span className="text-xs text-muted-foreground">{t('distribution.noLogo')}</span>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={onFile}
        />
        <Button size="sm" variant="outline" disabled={disabled} onClick={() => fileRef.current?.click()}>
          <Upload size={14} className="mr-1" /> {t('common.upload')}
        </Button>
        {draft.logoUrl && (
          <Button size="sm" variant="ghost" disabled={disabled} onClick={() => onSaved('')}>
            <Trash2 size={14} className="mr-1 text-destructive" /> {t('common.remove')}
          </Button>
        )}
      </div>
    </Panel>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-xs text-muted-foreground">{label}</span>
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} type={type} />
    </label>
  );
}

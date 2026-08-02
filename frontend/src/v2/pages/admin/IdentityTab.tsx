// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Save } from 'lucide-react';
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
}

type Draft = OidcView & { clientSecret: string };

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

  const save = async () => {
    setBusy(true);
    try {
      const { oidc } = await api.put<{ oidc: OidcView }>('/api/admin/oidc', {
        enabled: draft.enabled,
        issuer: draft.issuer,
        clientId: draft.clientId,
        publicUrl: draft.publicUrl,
        autoProvision: draft.autoProvision,
        buttonLabel: draft.buttonLabel,
        // Write-only : envoyé seulement si ressaisi.
        ...(draft.clientSecret ? { clientSecret: draft.clientSecret } : {}),
      });
      setDraft({ ...oidc, clientSecret: '' });
      qc.invalidateQueries({ queryKey: qk.admin('oidc') });
      toast.success(t('sso.saved'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-2xl">
      <Panel title="SSO OIDC (Google)">
        <p className="mb-3 text-xs text-muted-foreground">
          Connexion par fournisseur d'identité (authorization code). URL de redirection à déclarer chez le
          fournisseur : <code>{draft.publicUrl || '<URL publique>'}/api/auth/oidc/callback</code>
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
            <span className="text-xs text-muted-foreground">(email vérifié inconnu → nouveau compte)</span>
          </label>
          <Field
            label={t('sso.appUrl')}
            value={draft.publicUrl}
            onChange={(v) => set({ publicUrl: v })}
            placeholder="https://review.studio.com"
          />
          <Field
            label="Issuer"
            value={draft.issuer}
            onChange={(v) => set({ issuer: v })}
            placeholder="https://accounts.google.com"
          />
          <Field
            label="Client ID"
            value={draft.clientId}
            onChange={(v) => set({ clientId: v })}
            placeholder="xxxxx.apps.googleusercontent.com"
          />
          <Field
            label={`Client secret ${draft.hasSecret ? '(défini — laisser vide pour conserver)' : ''}`}
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
          <Button size="sm" onClick={save} disabled={busy}>
            <Save size={14} className="mr-1" /> Enregistrer
          </Button>
        </div>
      </Panel>
    </div>
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

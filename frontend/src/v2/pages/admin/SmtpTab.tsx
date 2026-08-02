// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { useAuth } from '../../stores/useAuth';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { SkeletonRows } from '../../components/ui/skeleton';
import type { SmtpConfig } from '../../types/api';
import { useT } from '../../i18n';

/** Configuration SMTP (admin) : champs en base, mot de passe chiffré write-only + envoi test. */
export default function SmtpTab() {
  const t = useT();
  const qc = useQueryClient();
  const myEmail = useAuth((s) => s.user?.email) ?? '';
  const { data, isLoading } = useQuery({
    queryKey: qk.admin('smtp'),
    queryFn: () => api.get<{ smtp: SmtpConfig }>('/api/studio/smtp').then((d) => d.smtp),
  });

  const [f, setF] = useState<Partial<SmtpConfig> & { password?: string }>({});
  const [testTo, setTestTo] = useState('');
  const [busy, setBusy] = useState(false);
  if (isLoading || !data) return <SkeletonRows count={5} />;
  const v = { ...data, ...f };

  const save = async () => {
    setBusy(true);
    try {
      const payload = {
        host: v.host,
        port: Number(v.port) || 587,
        secure: !!v.secure,
        user: v.user,
        from: v.from,
        ...(f.password ? { password: f.password } : {}),
      };
      await api.put('/api/studio/smtp', payload);
      qc.invalidateQueries({ queryKey: qk.admin('smtp') });
      setF({});
      toast.success(t('smtp.saved'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Enregistrement impossible');
    } finally {
      setBusy(false);
    }
  };

  const sendTest = async () => {
    const to = testTo || myEmail;
    if (!to) return toast.error(t('smtp.needRecipient'));
    setBusy(true);
    try {
      await api.post('/api/studio/smtp/test', { to });
      toast.success(`Email de test envoyé à ${to}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Envoi impossible');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-xl space-y-4">
      {data.envOverride && (
        <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
          La configuration d'environnement (`SMTP_*`) est active et prend le pas sur ces réglages.
        </p>
      )}

      <div className="space-y-2 rounded-lg border border-border p-3">
        <Row label={t('common.host')}>
          <Input
            value={v.host ?? ''}
            onChange={(e) => setF((s) => ({ ...s, host: e.target.value }))}
            placeholder="smtp.exemple.com"
          />
        </Row>
        <Row label="Port">
          <Input
            type="number"
            className="w-28"
            value={String(v.port ?? 587)}
            onChange={(e) => setF((s) => ({ ...s, port: Number(e.target.value) }))}
          />
        </Row>
        <Row label={t('smtp.secure')}>
          <input
            type="checkbox"
            className="accent-primary"
            checked={!!v.secure}
            onChange={(e) => setF((s) => ({ ...s, secure: e.target.checked }))}
          />
        </Row>
        <Row label="Utilisateur">
          <Input value={v.user ?? ''} onChange={(e) => setF((s) => ({ ...s, user: e.target.value }))} />
        </Row>
        <Row label={t('login.password')}>
          <Input
            type="password"
            value={f.password ?? ''}
            placeholder={data.hasPassword ? '•••••• (inchangé)' : 'non défini'}
            onChange={(e) => setF((s) => ({ ...s, password: e.target.value }))}
          />
        </Row>
        <Row label={t('smtp.from')}>
          <Input
            value={v.from ?? ''}
            onChange={(e) => setF((s) => ({ ...s, from: e.target.value }))}
            placeholder="ReView <no-reply@exemple.com>"
          />
        </Row>
        <div className="pt-1">
          <Button size="sm" onClick={save} disabled={busy}>
            {busy ? 'Enregistrement…' : 'Enregistrer'}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-border p-3">
        <label className="flex flex-1 flex-col gap-1 text-xs text-muted-foreground">
          Envoyer un email de test à
          <Input
            type="email"
            value={testTo}
            placeholder={myEmail}
            onChange={(e) => setTestTo(e.target.value)}
          />
        </label>
        <Button variant="outline" size="sm" onClick={sendTest} disabled={busy}>
          Envoyer le test
        </Button>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <label className="w-56 shrink-0 text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

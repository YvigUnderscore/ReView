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
import { QueryState } from '../../components/ui/query-state';
import type { SmtpConfig } from '../../types/api';
import { useT } from '../../i18n';
import { Hint } from '../../components/ui/hint';

/**
 * Vue du formulaire : la configuration rendue par le serveur, plus `allowInsecure`.
 *
 * Le champ est servi par `GET /api/studio/smtp` mais ne figure pas encore dans `SmtpConfig`
 * (`v2/types/api.ts`, hors du périmètre de ce lot) : on compose par intersection, jamais
 * en redéclarant l'entité — la règle de `v2/types/api.ts` interdit la seconde définition.
 */
type SmtpView = SmtpConfig & { allowInsecure?: boolean };

/** Configuration SMTP (admin) : champs en base, mot de passe chiffré write-only + envoi test. */
export default function SmtpTab() {
  const t = useT();
  const qc = useQueryClient();
  const myEmail = useAuth((s) => s.user?.email) ?? '';
  const smtpQ = useQuery({
    queryKey: qk.admin('smtp'),
    queryFn: () => api.get<{ smtp: SmtpView }>('/api/studio/smtp').then((d) => d.smtp),
  });
  const data = smtpQ.data;

  const [f, setF] = useState<Partial<SmtpView> & { password?: string }>({});
  const [testTo, setTestTo] = useState('');
  const [busy, setBusy] = useState(false);
  if (!data) return <QueryState query={smtpQ} skeleton={<SkeletonRows count={5} />} />;
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
        // Toujours envoyé, jamais conditionné à `f.allowInsecure` : le service conserve la
        // valeur en place quand le champ est absent, si bien qu'un décochage seul — sans
        // autre modification — n'aurait rien remis en sécurité.
        allowInsecure: !!v.allowInsecure,
        ...(f.password ? { password: f.password } : {}),
      };
      await api.put('/api/studio/smtp', payload);
      void qc.invalidateQueries({ queryKey: qk.admin('smtp') });
      setF({});
      toast.success(t('smtp.saved'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('common.error.save'));
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
      toast.success(t('smtp.testSent', { to }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('common.error.send'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-xl space-y-4">
      {data.envOverride && (
        <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
          {t('smtp.envActive')}
        </p>
      )}

      <div className="space-y-2 rounded-lg border border-border p-3">
        <Row label={t('common.host')}>
          <Input
            value={v.host ?? ''}
            onChange={(e) => setF((s) => ({ ...s, host: e.target.value }))}
            placeholder="smtp.example.com"
            aria-label="smtp.example.com"
          />
        </Row>
        <Row label={t('smtp.port')}>
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
        <Row label={t('common.user')}>
          <Input value={v.user ?? ''} onChange={(e) => setF((s) => ({ ...s, user: e.target.value }))} />
        </Row>
        <Row label={t('login.password')}>
          <Input
            type="password"
            value={f.password ?? ''}
            placeholder={data.hasPassword ? t('smtp.unchanged') : t('smtp.unset')}
            aria-label={data.hasPassword ? t('smtp.unchanged') : t('smtp.unset')}
            onChange={(e) => setF((s) => ({ ...s, password: e.target.value }))}
          />
        </Row>
        <Row label={t('smtp.from')}>
          <Input
            value={v.from ?? ''}
            onChange={(e) => setF((s) => ({ ...s, from: e.target.value }))}
            placeholder={t('smtp.fromPlaceholder')}
            aria-label={t('smtp.fromPlaceholder')}
          />
        </Row>
        {/*
          Le réglage sort de la liste des champs, et porte la couleur du danger.
          Aligné en `Row` entre « Port » et « Expéditeur », il se cocherait comme une
          préférence d'affichage : or il retire le chiffrement du transport, donc remet le
          mot de passe du relais et chaque lien d'invitation en clair sur le réseau. La
          conséquence est écrite sous le libellé, pas renvoyée à une infobulle.
        */}
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2.5">
          <label className="flex cursor-pointer items-start gap-2">
            <input
              type="checkbox"
              className="mt-0.5 accent-destructive"
              checked={!!v.allowInsecure}
              onChange={(e) => setF((s) => ({ ...s, allowInsecure: e.target.checked }))}
            />
            <span className="text-sm font-medium text-destructive">{t('smtp.allowInsecure')}</span>
          </label>
          <Hint className="pl-6">{t('smtp.allowInsecureHint')}</Hint>
        </div>
        <div className="pt-1">
          <Button size="sm" onClick={save} disabled={busy}>
            {busy ? t('common.saving') : t('common.save')}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-border p-3">
        <label className="flex flex-1 flex-col gap-1 text-xs text-muted-foreground">
          {t('smtp.sendTestTo')}
          <Input
            type="email"
            value={testTo}
            placeholder={myEmail}
            aria-label={myEmail}
            onChange={(e) => setTestTo(e.target.value)}
          />
        </label>
        <Button variant="outline" size="sm" onClick={sendTest} disabled={busy}>
          {t('smtp.sendTest')}
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

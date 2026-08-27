// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Select } from '../../components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import ScopePicker from '../../components/tokens/ScopePicker';
import TokenSecret from '../../components/tokens/TokenSecret';
import { serviceTokensKey } from '../../components/tokens/tokenApi';
import { buildTokenDraft, EXPIRY_CHOICES } from '../../components/tokens/tokenScopes';
import { useT, type MessageKey } from '../../i18n';
import type { AdminProjectRow } from '../../types/api';

/** Traducteur passé aux tables de libellés, recalculées à chaque rendu. */
type Tr = (key: MessageKey, params?: Record<string, string | number>) => string;

/** ADMIN volontairement absent : le serveur le refuse — un robot n'administre pas le studio. */
const roleOptions = (t: Tr) => [
  { value: 'ARTIST', label: t('role.artist') },
  { value: 'SUPERVISOR', label: t('role.supervisor') },
  { value: 'CLIENT', label: t('role.client') },
];

const expiryLabel = (t: Tr, choice: string): string =>
  choice === '' ? t('common.never') : t('tokens.expiry.days', { count: Number(choice) });

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="block text-xs font-medium">{label}</span>
      {children}
      {hint && <span className="block text-2xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

/**
 * Émission d'un token de service : identité machine pour une ferme de rendu, un daemon de
 * pipeline ou un bot. Ce que l'écran expose et que le curl exposait seul jusqu'ici : rôle
 * effectif du porteur, cantonnement à un projet, expiration, scopes fins.
 *
 * Le mot de passe de l'admin est exigé par le serveur : un token de service ne meurt pas
 * avec la session de son auteur, un jeton d'accès volé ne doit pas suffire à en forger un.
 */
export default function ServiceTokenDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const projectsQ = useQuery({
    queryKey: qk.adminProjects,
    queryFn: () => api.get<{ projects: AdminProjectRow[] }>('/api/admin/projects'),
    enabled: open,
  });

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [role, setRole] = useState('ARTIST');
  const [projectId, setProjectId] = useState('');
  const [expiry, setExpiry] = useState<string>('365');
  const [scopes, setScopes] = useState<string[]>([]);
  const [currentPassword, setCurrentPassword] = useState('');
  const [secret, setSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const draft = buildTokenDraft({ name, description, scopes, projectId, expiry, currentPassword });

  const close = () => {
    setName('');
    setDescription('');
    setRole('ARTIST');
    setProjectId('');
    setExpiry('365');
    setScopes([]);
    setCurrentPassword('');
    setSecret(null);
    onClose();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    setBusy(true);
    try {
      const created = await api.post<{ token: string }>('/api/admin/service-tokens', { ...draft, role });
      setSecret(created.token);
      setCurrentPassword('');
      toast.success(t('tokens.service.created'));
      void qc.invalidateQueries({ queryKey: serviceTokensKey });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error.generic'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('tokens.service.new')}</DialogTitle>
          <DialogDescription>{t('tokens.service.newHint')}</DialogDescription>
        </DialogHeader>
        {secret ? (
          <div className="space-y-3">
            <TokenSecret secret={secret} />
            <p className="text-xs text-muted-foreground">
              {t('tokens.service.usage')} <code>Authorization: Bearer rvk_…</code>
            </p>
            <DialogFooter>
              <Button size="sm" onClick={close}>
                {t('common.close')}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <Field label={t('common.name')} hint={t('tokens.service.nameHint')}>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
                autoFocus
                className="w-full"
              />
            </Field>
            <Field label={t('common.description')}>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={300}
                className="w-full"
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label={t('common.role')} hint={t('tokens.service.roleHint')}>
                <Select value={role} onChange={(e) => setRole(e.target.value)} className="w-full py-1.5">
                  {roleOptions(t).map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('common.project')} hint={t('tokens.service.projectHint')}>
                <Select
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                  className="w-full py-1.5"
                >
                  <option value="">{t('tokens.allProjects')}</option>
                  {(projectsQ.data?.projects ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('tokens.expiry.label')}>
                <Select value={expiry} onChange={(e) => setExpiry(e.target.value)} className="w-full py-1.5">
                  {EXPIRY_CHOICES.map((c) => (
                    <option key={c} value={c}>
                      {expiryLabel(t, c)}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <ScopePicker value={scopes} onChange={setScopes} idPrefix="svc" />
            <Field label={t('profile.password.current')} hint={t('tokens.service.passwordHint')}>
              <Input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
                placeholder={t('profile.password.currentPlaceholder')}
                aria-label={t('profile.password.currentPlaceholder')}
                className="w-full"
              />
            </Field>
            <DialogFooter>
              <Button type="button" variant="ghost" size="sm" onClick={close}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" size="sm" disabled={busy || !draft || !currentPassword}>
                {t('tokens.service.emit')}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

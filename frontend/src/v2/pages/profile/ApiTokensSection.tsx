// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Plus, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { useProjectsQuery } from '../../lib/queries';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Select } from '../../components/ui/select';
import EntityContextMenu from '../../components/ui/entity-menu';
import ScopePicker from '../../components/tokens/ScopePicker';
import TokenSecret from '../../components/tokens/TokenSecret';
import type { TokenRow } from '../../components/tokens/tokenApi';
import {
  buildTokenDraft,
  EXPIRY_CHOICES,
  scopeLevel,
  type ScopeLevel,
} from '../../components/tokens/tokenScopes';
import { useT, intlLocale, type MessageKey } from '../../i18n';

/** Traducteur passé aux tables de libellés, recalculées à chaque rendu. */
type Tr = (key: MessageKey, params?: Record<string, string | number>) => string;

const fmt = (iso: string) =>
  new Date(iso).toLocaleDateString(intlLocale(), { day: '2-digit', month: 'short', year: 'numeric' });

const LEVEL_KEY: Record<ScopeLevel, MessageKey> = {
  admin: 'tokens.scope.adminBadge',
  write: 'tokens.readWrite',
  read: 'tokens.read',
};

const expiryLabel = (t: Tr, choice: string): string =>
  choice === '' ? t('common.never') : t('tokens.expiry.days', { count: Number(choice) });

/**
 * Tokens d'API personnels (36.C) : création (secret montré une fois), liste, révocation.
 *
 * Le formulaire porte désormais tout ce que le serveur accepte — scopes fins,
 * cantonnement à un projet, expiration — et le mot de passe courant qu'il exige : sans
 * lui, la création répondait 403 et l'écran ne savait pas pourquoi.
 */
export default function ApiTokensSection() {
  const t = useT();
  const qc = useQueryClient();
  const tokensQ = useQuery({
    queryKey: qk.apiTokens,
    queryFn: () => api.get<{ tokens: TokenRow[] }>('/api/auth/tokens').then((d) => d.tokens),
  });
  const tokens = tokensQ.data ?? [];
  const [open, setOpen] = useState(false);
  const projectsQ = useProjectsQuery({ all: true });

  const [name, setName] = useState('');
  const [projectId, setProjectId] = useState('');
  const [expiry, setExpiry] = useState<string>('365');
  const [scopes, setScopes] = useState<string[]>([]);
  const [currentPassword, setCurrentPassword] = useState('');
  const [secret, setSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const draft = buildTokenDraft({ name, scopes, projectId, expiry, currentPassword });

  const reset = () => {
    setName('');
    setProjectId('');
    setExpiry('365');
    setScopes([]);
    setCurrentPassword('');
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    setBusy(true);
    try {
      const created = await api.post<{ token: string }>('/api/auth/tokens', draft);
      setSecret(created.token);
      reset();
      setOpen(false);
      toast.success(t('tokens.created'));
      void qc.invalidateQueries({ queryKey: qk.apiTokens });
    } catch (err) {
      setCurrentPassword('');
      toast.error(err instanceof Error ? err.message : t('common.error.generic'));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: number) => {
    try {
      await api.del(`/api/auth/tokens/${id}`);
      toast.success(t('tokens.revoked'));
      void qc.invalidateQueries({ queryKey: qk.apiTokens });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error.generic'));
    }
  };

  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">{t('tokens.title')}</h2>
          <p className="text-xs text-muted-foreground">
            {t('tokens.intro')} <code>Authorization: Bearer rvk_…</code>
          </p>
        </div>
        <Button size="sm" variant={open ? 'ghost' : 'default'} onClick={() => setOpen((v) => !v)}>
          {open ? <X size={14} className="mr-1" /> : <Plus size={14} className="mr-1" />}
          {open ? t('common.cancel') : t('tokens.new')}
        </Button>
      </div>
      {secret && <TokenSecret secret={secret} />}
      {open && (
        <form onSubmit={create} className="space-y-3 rounded-md border border-border p-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block space-y-1">
              <span className="block text-xs font-medium">{t('common.name')}</span>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('tokens.namePlaceholder')}
                maxLength={80}
                className="w-full"
              />
            </label>
            <label className="block space-y-1">
              <span className="block text-xs font-medium">{t('common.project')}</span>
              <Select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="w-full py-1.5"
              >
                <option value="">{t('tokens.allProjects')}</option>
                {(projectsQ.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </label>
            <label className="block space-y-1">
              <span className="block text-xs font-medium">{t('tokens.expiry.label')}</span>
              <Select value={expiry} onChange={(e) => setExpiry(e.target.value)} className="w-full py-1.5">
                {EXPIRY_CHOICES.map((c) => (
                  <option key={c} value={c}>
                    {expiryLabel(t, c)}
                  </option>
                ))}
              </Select>
            </label>
          </div>
          <ScopePicker value={scopes} onChange={setScopes} idPrefix="me" />
          <label className="block space-y-1">
            <span className="block text-xs font-medium">{t('profile.password.current')}</span>
            <Input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
              placeholder={t('profile.password.currentPlaceholder')}
              className="w-full"
            />
            <span className="block text-2xs text-muted-foreground">{t('tokens.passwordHint')}</span>
          </label>
          <Button type="submit" size="sm" disabled={busy || !draft || !currentPassword}>
            {t('common.create')}
          </Button>
        </form>
      )}
      <div className="space-y-1.5">
        {tokens.length === 0 && <p className="text-xs text-muted-foreground">{t('tokens.empty')}</p>}
        {tokens.map((tok) => (
          <EntityContextMenu
            key={tok.id}
            entries={[
              {
                id: 'revoke',
                label: t('shares.revoke'),
                icon: <Trash2 size={14} />,
                danger: true,
                onSelect: () => void revoke(tok.id),
              },
            ]}
          >
            <div className="flex items-center gap-3 rounded-md border border-border bg-background px-3 py-2 text-sm">
              <KeyRound size={15} className="shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="truncate font-medium">{tok.name}</span>
                  <Badge variant={scopeLevel(tok.scopes) === 'read' ? 'secondary' : 'warning'}>
                    {t(LEVEL_KEY[scopeLevel(tok.scopes)])}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t('tokens.createdOn', { date: fmt(tok.createdAt) })}
                  {tok.lastUsedAt
                    ? ` · ${t('tokens.usedOn', { date: fmt(tok.lastUsedAt) })}`
                    : ` · ${t('common.neverUsed')}`}
                  {tok.expiresAt ? ` · ${t('tokens.expiresOn', { date: fmt(tok.expiresAt) })}` : ''}
                </p>
                <p className="truncate text-2xs text-muted-foreground">
                  <code>{tok.scopes.join(' ')}</code>
                </p>
              </div>
            </div>
          </EntityContextMenu>
        ))}
        {tokens.length > 0 && <p className="pt-1 text-2xs text-muted-foreground">{t('tokens.revokeHint')}</p>}
      </div>
    </section>
  );
}

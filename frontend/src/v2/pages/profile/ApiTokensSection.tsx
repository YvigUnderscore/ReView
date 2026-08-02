// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, KeyRound, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Select } from '../../components/ui/select';
import { useT } from '../../i18n';
import { intlLocale } from '../../i18n';

interface TokenRow {
  id: number;
  name: string;
  scopes: string[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

const fmt = (iso: string) =>
  new Date(iso).toLocaleDateString(intlLocale(), { day: '2-digit', month: 'short', year: 'numeric' });

/** Tokens d'API personnels (36.C) : création (secret montré une fois), liste, révocation. */
export default function ApiTokensSection() {
  const t = useT();
  const tr = useT();
  const qc = useQueryClient();
  const tokensQ = useQuery({
    queryKey: qk.apiTokens,
    queryFn: () => api.get<{ tokens: TokenRow[] }>('/api/auth/tokens').then((d) => d.tokens),
  });
  const tokens = tokensQ.data ?? [];

  const [name, setName] = useState('');
  const [scope, setScope] = useState<'read' | 'write'>('read');
  const [secret, setSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      const { token } = await api.post<{ token: string }>('/api/auth/tokens', {
        name: name.trim(),
        scopes: scope === 'write' ? ['read', 'write'] : ['read'],
      });
      setSecret(token);
      setName('');
      qc.invalidateQueries({ queryKey: qk.apiTokens });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: number) => {
    try {
      await api.del(`/api/auth/tokens/${id}`);
      toast.success(tr('tokens.revoked'));
      qc.invalidateQueries({ queryKey: qk.apiTokens });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erreur');
    }
  };

  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-4">
      <h2 className="text-sm font-semibold">Tokens d'API</h2>
      <p className="text-xs text-muted-foreground">
        {t('tokens.intro')} <code>Authorization: Bearer rvk_…</code>. Le scope « lecture » n'autorise que les
        GET.
      </p>
      <form onSubmit={create} className="flex gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('tokens.namePlaceholder')}
          maxLength={80}
          className="flex-1"
        />
        <Select value={scope} onChange={(e) => setScope(e.target.value as 'read' | 'write')}>
          <option value="read">Lecture</option>
          <option value="write">{t('tokens.readWrite')}</option>
        </Select>
        <Button type="submit" size="sm" disabled={busy || !name.trim()}>
          <Plus size={14} className="mr-1" /> {t('common.create')}
        </Button>
      </form>
      {secret && (
        <div className="flex items-center gap-2 rounded-md border border-primary/40 bg-primary/10 px-3 py-2">
          <code className="min-w-0 flex-1 truncate text-xs">{secret}</code>
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              await navigator.clipboard.writeText(secret);
              toast.success(t('tokens.copied'));
            }}
          >
            <Copy size={14} />
          </Button>
        </div>
      )}
      <div className="space-y-1.5">
        {tokens.map((t) => (
          <div
            key={t.id}
            className="flex items-center gap-3 rounded-md border border-border bg-background px-3 py-2 text-sm"
          >
            <KeyRound size={15} className="shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate font-medium">{t.name}</span>
                <Badge variant={t.scopes.includes('write') ? 'warning' : 'secondary'}>
                  {t.scopes.includes('write') ? 'écriture' : 'lecture'}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                Créé le {fmt(t.createdAt)}
                {t.lastUsedAt ? ` · utilisé le ${fmt(t.lastUsedAt)}` : ' · jamais utilisé'}
                {t.expiresAt ? ` · expire le ${fmt(t.expiresAt)}` : ''}
              </p>
            </div>
            <Button variant="ghost" size="sm" title={tr('shares.revoke')} onClick={() => revoke(t.id)}>
              <Trash2 size={14} className="text-destructive" />
            </Button>
          </div>
        ))}
      </div>
    </section>
  );
}

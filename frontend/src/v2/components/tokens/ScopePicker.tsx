// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { ShieldAlert } from 'lucide-react';
import { Checkbox } from '../ui/checkbox';
import { Label } from '../ui/label';
import { useT } from '../../i18n';
import { useScopeCatalog } from './tokenApi';
import { ADMIN_SCOPE, groupScopes, isScopeOn, toggleScope } from './tokenScopes';

/**
 * Sélecteur de scopes, alimenté par le catalogue du serveur (`GET /api/auth/scopes`).
 *
 * Les noms de scopes (`versions:write`) sont des identifiants d'API, pas de la prose :
 * ils s'affichent en `<code>`, tels qu'on les écrira dans un script. Seules les colonnes
 * (lire / écrire) et les avertissements se traduisent.
 */
export default function ScopePicker({
  value,
  onChange,
  idPrefix = 'scope',
}: {
  value: string[];
  onChange: (next: string[]) => void;
  /** Distingue deux sélecteurs montés en même temps (profil ↔ dialogue d'admin). */
  idPrefix?: string;
}) {
  const t = useT();
  const catalogQ = useScopeCatalog();
  const { domains, standalone } = groupScopes(catalogQ.data?.scopes ?? []);
  const locked = value.includes(ADMIN_SCOPE);

  if (catalogQ.isPending) return <p className="text-xs text-muted-foreground">{t('common.loading')}</p>;
  if (catalogQ.isError) return <p className="text-xs text-destructive">{t('tokens.scope.unavailable')}</p>;

  const box = (scope: string | null, domain: string, action: 'read' | 'write') => {
    if (!scope) return <span className="w-16" />;
    const id = `${idPrefix}-${domain}-${action}`;
    return (
      <span className="flex w-16 items-center gap-1.5">
        <Checkbox
          id={id}
          checked={isScopeOn(value, scope)}
          disabled={locked}
          onCheckedChange={(checked) => onChange(toggleScope(value, scope, checked === true))}
        />
        <Label htmlFor={id} className="text-2xs font-normal text-muted-foreground">
          {action === 'read' ? t('tokens.scope.read') : t('tokens.scope.write')}
        </Label>
      </span>
    );
  };

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">{t('tokens.scope.hint')}</p>
      <div className="grid gap-1 rounded-md border border-border bg-background p-2 sm:grid-cols-2">
        {domains.map((row) => (
          <div key={row.domain} className="flex items-center gap-2 px-1 py-0.5">
            <code className="min-w-0 flex-1 truncate text-xs">{row.domain}</code>
            {box(row.read, row.domain, 'read')}
            {box(row.write, row.domain, 'write')}
          </div>
        ))}
      </div>
      {standalone.map((scope) => (
        <label
          key={scope}
          className="flex items-start gap-2 rounded-md border border-border bg-background px-2 py-1.5"
          htmlFor={`${idPrefix}-${scope}`}
        >
          <Checkbox
            id={`${idPrefix}-${scope}`}
            checked={value.includes(scope)}
            onCheckedChange={(checked) => onChange(toggleScope(value, scope, checked === true))}
            className="mt-0.5"
          />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5 text-xs font-medium">
              <ShieldAlert size={13} className="text-warning" />
              <code>{scope}</code>
            </span>
            <span className="block text-2xs text-muted-foreground">
              {scope === ADMIN_SCOPE ? t('tokens.scope.adminHint') : t('tokens.scope.unknownHint')}
            </span>
          </span>
        </label>
      ))}
    </div>
  );
}

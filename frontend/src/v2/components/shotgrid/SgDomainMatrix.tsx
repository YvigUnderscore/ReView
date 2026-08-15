// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { ArrowLeftRight, ArrowRight, Lock } from 'lucide-react';
import { useT } from '../../i18n';
import type { SgDomain, SgSettings } from '../../types/shotgrid';

/**
 * Matrice des échanges : pour chaque domaine, ce que ReView lit de ShotGrid et ce
 * qu'il y écrit. Chaque case est une décision — d'où la description de conséquence
 * sous chaque ligne plutôt qu'un simple libellé.
 */

const DOMAINS: SgDomain[] = ['hierarchy', 'tasks', 'statuses', 'versions', 'notes', 'playlists', 'users'];

/** Domaines dont l'écriture n'a pas de sens : ReView ne redéfinit pas ces référentiels. */
const READ_ONLY: SgDomain[] = ['statuses', 'users'];

export default function SgDomainMatrix({
  settings,
  onChange,
  disabled,
}: {
  settings: SgSettings;
  onChange: (patch: Partial<SgSettings>) => void;
  disabled?: boolean;
}) {
  const t = useT();

  const toggle = (domain: SgDomain, direction: 'read' | 'write', value: boolean) => {
    onChange({
      domains: {
        ...settings.domains,
        [domain]: { ...settings.domains[domain], [direction]: value },
      },
    });
  };

  return (
    <div className="overflow-hidden rounded-md border border-border">
      <table className="w-full text-sm">
        <thead className="bg-secondary/40 text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left font-medium">{t('shotgrid.matrix.domain')}</th>
            <th className="w-32 px-3 py-2 text-center font-medium">
              <span className="inline-flex items-center gap-1">
                <ArrowRight size={12} /> {t('shotgrid.matrix.read')}
              </span>
            </th>
            <th className="w-32 px-3 py-2 text-center font-medium">
              <span className="inline-flex items-center gap-1">
                <ArrowLeftRight size={12} /> {t('shotgrid.matrix.write')}
              </span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {DOMAINS.map((domain) => {
            const access = settings.domains[domain];
            const readOnly = READ_ONLY.includes(domain);
            return (
              <tr key={domain}>
                <td className="px-3 py-2">
                  <div className="font-medium">{t(`shotgrid.domain.${domain}` as never)}</div>
                  <div className="text-xs text-muted-foreground">
                    {t(`shotgrid.domain.${domain}.hint` as never)}
                  </div>
                </td>
                <td className="px-3 py-2 text-center">
                  <input
                    type="checkbox"
                    checked={access.read}
                    disabled={disabled}
                    onChange={(e) => toggle(domain, 'read', e.target.checked)}
                    aria-label={t('shotgrid.matrix.readAria', {
                      domain: t(`shotgrid.domain.${domain}` as never),
                    })}
                  />
                </td>
                <td className="px-3 py-2 text-center">
                  {readOnly ? (
                    <span
                      className="inline-flex items-center gap-1 text-xs text-muted-foreground"
                      title={t('shotgrid.matrix.readOnlyHint')}
                    >
                      <Lock size={12} /> {t('shotgrid.matrix.readOnly')}
                    </span>
                  ) : (
                    <input
                      type="checkbox"
                      checked={access.write}
                      disabled={disabled}
                      onChange={(e) => toggle(domain, 'write', e.target.checked)}
                      aria-label={t('shotgrid.matrix.writeAria', {
                        domain: t(`shotgrid.domain.${domain}` as never),
                      })}
                    />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

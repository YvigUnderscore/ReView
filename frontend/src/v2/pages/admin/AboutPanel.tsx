// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useQuery } from '@tanstack/react-query';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { useT } from '../../i18n';
import { Panel, Row } from './AdminPrimitives';
import { displayVersion, formatBuildDate, type InstanceVersion } from './aboutInstance';

/**
 * Identité de l'instance : quelle version tourne, construite quand, sur quel runtime.
 *
 * Aucune surface ne le disait — ni l'API, ni la sonde, ni l'interface : deux installations
 * faites à deux dates étaient indiscernables, et le support ne pouvait rien diagnostiquer à
 * distance. La source est `GET /api/version`, la même que lit la supervision, pour qu'un
 * exploitant et nous parlions de la même chose.
 */
export default function AboutPanel() {
  const t = useT();
  const { data } = useQuery({
    queryKey: qk.admin('version'),
    queryFn: () => api.get<InstanceVersion>('/api/version'),
    // La version d'un process ne change qu'au redémarrage : inutile de la redemander.
    staleTime: 5 * 60 * 1000,
  });

  const built = formatBuildDate(data?.builtAt ?? null);
  return (
    <Panel title={t('about.title')}>
      <dl className="space-y-1 text-sm">
        <Row label={t('about.version')} value={data ? displayVersion(data) : '—'} />
        <Row label={t('about.builtAt')} value={built ?? t('about.builtAtUnknown')} />
        <Row label={t('about.runtime')} value={data?.node ?? '—'} />
      </dl>
      <p className="mt-3 text-xs text-muted-foreground">{t('about.hint')}</p>
    </Panel>
  );
}

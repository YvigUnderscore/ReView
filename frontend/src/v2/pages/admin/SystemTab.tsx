// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { useBranding } from '../../lib/branding';
import { Button } from '../../components/ui/button';
import { SkeletonRows } from '../../components/ui/skeleton';
import { Gauge, Panel, Row, ServiceHealth } from './AdminPrimitives';
import { fmtBytes, fmtDuration, type System } from './adminShared';
import { useT } from '../../i18n';

export default function SystemTab() {
  const t = useT();
  const qc = useQueryClient();
  const { data: system } = useQuery({
    queryKey: qk.admin('system'),
    queryFn: () => api.get<System>('/api/admin/system'),
  });
  if (!system) return <SkeletonRows count={3} />;
  const memPct = Math.round((system.memory.used / system.memory.total) * 100);
  const diskPct = system.disk
    ? Math.round(((system.disk.total - system.disk.free) / system.disk.total) * 100)
    : null;
  return (
    <div className="space-y-4">
      <Button
        variant="outline"
        size="sm"
        onClick={() => qc.invalidateQueries({ queryKey: qk.admin('system') })}
      >
        <RefreshCw size={13} /> {t('common.refresh')}
      </Button>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={t('common.host')}>
          <dl className="space-y-1 text-sm">
            <Row k="Plateforme" v={`${system.host.platform} (${system.host.arch})`} />
            <Row k="Node.js" v={system.host.nodeVersion} />
            <Row k="CPU" v={`${system.host.cpus} cœurs`} />
            <Row k="Charge (1/5/15 min)" v={system.host.loadAvg.map((l) => l.toFixed(2)).join(' / ')} />
            <Row k="Uptime machine" v={fmtDuration(system.host.uptimeSec)} />
            <Row k="Uptime process" v={fmtDuration(system.host.processUptimeSec)} />
          </dl>
        </Panel>
        <Panel title="Ressources">
          <div className="space-y-3">
            <Gauge
              label={`Mémoire — ${fmtBytes(system.memory.used)} / ${fmtBytes(system.memory.total)}`}
              pct={memPct}
            />
            {diskPct !== null && system.disk && (
              <Gauge
                label={`Disque — ${fmtBytes(system.disk.total - system.disk.free)} / ${fmtBytes(system.disk.total)}`}
                pct={diskPct}
              />
            )}
            <Row k="RSS process" v={fmtBytes(system.memory.processRss)} />
          </div>
        </Panel>
      </div>
      <Panel title={t('overview.serviceHealth')}>
        <ServiceHealth services={system.services} />
      </Panel>
      <LicensePanel />
    </div>
  );
}

/**
 * Licence de l'instance. L'AGPL §13 oblige à offrir le code source **correspondant** :
 * un studio qui fait tourner une version modifiée doit renseigner ses propres sources
 * (onglet Réglages → « Code source (AGPL §13) »), sinon le lien renvoie vers l'amont.
 */
function LicensePanel() {
  const t = useT();
  const { data: branding } = useBranding();
  return (
    <Panel title="Licence & code source">
      <dl className="space-y-1 text-sm">
        <Row k="Licence" v="AGPL-3.0-or-later" />
        <Row k="Dépendances tierces" v="THIRD-PARTY-NOTICES.md (racine du dépôt)" />
        <div className="flex justify-between">
          <dt className="text-muted-foreground">{t('system.sourcePublished')}</dt>
          <dd>
            <a
              href={branding?.sourceUrl ?? 'https://github.com/YvigUnderscore/ReView'}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2 hover:text-primary"
            >
              {branding?.sourceUrl ?? '—'}
            </a>
          </dd>
        </div>
      </dl>
      <p className="mt-3 text-xs text-muted-foreground">
        Toute personne qui utilise cette instance à distance doit pouvoir en récupérer les sources. Si vous
        l’avez modifiée, faites pointer le réglage « Code source » vers votre dépôt.
      </p>
    </Panel>
  );
}

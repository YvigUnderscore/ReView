// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { AlertTriangle, ExternalLink, Link2Off, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useT, intlLocale } from '../../i18n';
import { useDeleteSgConnection, useSgConnection } from '../../lib/shotgridApi';
import SgConnectionSetup from '../../components/shotgrid/SgConnectionSetup';
import SgSettingsPanel from '../../components/shotgrid/SgSettingsPanel';
import SgSyncPanel from '../../components/shotgrid/SgSyncPanel';
import SgDiffPanel from '../../components/shotgrid/SgDiffPanel';
import SgVersionsPanel from '../../components/shotgrid/SgVersionsPanel';

/**
 * Onglet ShotGrid d'un projet : état de la connexion, synchronisations, comparaison,
 * publishes et réglages de l'échange. Tout ce qui concerne le lien avec le registre de
 * production se pilote depuis cet écran.
 */
type Section = 'sync' | 'diff' | 'versions' | 'settings';

export default function ShotgridTab({ projectId, canManage }: { projectId: number; canManage: boolean }) {
  const t = useT();
  const { data: connection, isLoading } = useSgConnection(projectId);
  const disconnect = useDeleteSgConnection(projectId);
  const [section, setSection] = useState<Section>('sync');

  if (isLoading) return <Loader2 className="animate-spin text-muted-foreground" size={18} />;

  if (!connection) {
    if (!canManage) return <p className="text-sm text-muted-foreground">{t('shotgrid.tab.notConnected')}</p>;
    return (
      <div className="max-w-2xl space-y-4">
        <div>
          <h2 className="text-base font-medium">{t('shotgrid.tab.connectTitle')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t('shotgrid.tab.connectIntro')}</p>
        </div>
        <SgConnectionSetup projectId={projectId} />
      </div>
    );
  }

  const statusTone =
    connection.status === 'ok'
      ? 'border-success/40 bg-success/10'
      : connection.status === 'syncing'
        ? 'border-info/40 bg-info/10'
        : 'border-destructive/40 bg-destructive/10';

  const sections: Section[] = ['sync', 'diff', 'versions', 'settings'];

  return (
    <div className="space-y-5">
      <div className={`rounded-md border p-3 ${statusTone}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="flex items-center gap-2 text-sm font-medium">
              {connection.status !== 'ok' && <AlertTriangle size={14} />}
              {t('shotgrid.tab.linkedTo')}
              <a
                href={connection.sgProjectUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 hover:underline"
              >
                {connection.sgProjectName} <ExternalLink size={12} />
              </a>
              <span className="text-xs text-muted-foreground">#{connection.sgProjectId}</span>
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {connection.site.name} · {t(`shotgrid.connStatus.${connection.status}` as never)}
              {connection.lastSyncAt &&
                ` · ${t('shotgrid.tab.lastSync', {
                  date: new Date(connection.lastSyncAt).toLocaleString(intlLocale()),
                })}`}
            </p>
            {connection.statusMessage && (
              <p className="mt-1 text-xs text-destructive">{connection.statusMessage}</p>
            )}
          </div>
          {canManage && (
            <button
              type="button"
              onClick={async () => {
                if (!window.confirm(t('shotgrid.tab.disconnectConfirm'))) return;
                await disconnect.mutateAsync();
                toast.success(t('shotgrid.tab.disconnected'));
              }}
              className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-secondary/60"
            >
              <Link2Off size={14} /> {t('shotgrid.tab.disconnect')}
            </button>
          )}
        </div>
      </div>

      <div className="flex gap-1 border-b border-border">
        {sections.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setSection(key)}
            className={`px-3 py-1.5 text-sm transition-colors ${
              section === key
                ? 'border-b-2 border-primary text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t(`shotgrid.section.${key}` as never)}
          </button>
        ))}
      </div>

      {section === 'sync' && <SgSyncPanel connection={connection} canManage={canManage} />}
      {section === 'diff' && <SgDiffPanel connection={connection} canManage={canManage} />}
      {section === 'versions' && <SgVersionsPanel projectId={projectId} canManage={canManage} />}
      {section === 'settings' && <SgSettingsPanel connection={connection} canManage={canManage} />}
    </div>
  );
}

// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { ExternalLink, Link2, Link2Off, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useT } from '../../i18n';
import { useDeleteSgConnection, useSgConnection } from '../../lib/shotgridApi';
import SgConnectionSetup from './SgConnectionSetup';

/**
 * Liaison ShotGrid dans les réglages du projet.
 *
 * C'est ici qu'on relie ou délie, pas dans un onglet : un projet non relié n'a aucune
 * raison de porter un onglet ShotGrid en permanence. Une fois la liaison faite,
 * l'onglet apparaît et prend le relais pour tout le reste.
 */
export default function SgProjectSection({
  projectId,
  canManage,
}: {
  projectId: number;
  canManage: boolean;
}) {
  const t = useT();
  const { data: connection, isLoading } = useSgConnection(projectId);
  const disconnect = useDeleteSgConnection(projectId);
  const [connecting, setConnecting] = useState(false);

  if (!canManage || isLoading) return null;

  if (connection?.active)
    return (
      <section className="rounded-md border border-border p-4">
        <h3 className="mb-2 flex items-center gap-2 text-sm font-medium">
          <Link2 size={15} /> {t('shotgrid.tab.label')}
        </h3>
        <p className="text-sm">
          {t('shotgrid.tab.linkedTo')}{' '}
          <a
            href={connection.sgProjectUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 hover:underline"
          >
            {connection.sgProjectName} <ExternalLink size={12} />
          </a>
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{t('shotgrid.settings.tabHint')}</p>
        <button
          type="button"
          onClick={async () => {
            if (!window.confirm(t('shotgrid.tab.disconnectConfirm'))) return;
            await disconnect.mutateAsync();
            toast.success(t('shotgrid.tab.disconnected'));
          }}
          className="mt-3 flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-secondary/60"
        >
          <Link2Off size={14} /> {t('shotgrid.tab.disconnect')}
        </button>
      </section>
    );

  return (
    <section className="rounded-md border border-border p-4">
      <h3 className="mb-2 flex items-center gap-2 text-sm font-medium">
        <Link2 size={15} /> {t('shotgrid.tab.label')}
      </h3>
      {connecting ? (
        <>
          <p className="mb-3 text-sm text-muted-foreground">{t('shotgrid.tab.connectIntro')}</p>
          <SgConnectionSetup projectId={projectId} />
          <button
            type="button"
            onClick={() => setConnecting(false)}
            className="mt-3 text-xs text-muted-foreground hover:text-foreground"
          >
            {t('common.cancel')}
          </button>
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">{t('shotgrid.settings.notLinked')}</p>
          <button
            type="button"
            onClick={() => setConnecting(true)}
            className="mt-3 flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-secondary/60"
          >
            {disconnect.isPending ? <Loader2 className="animate-spin" size={14} /> : <Link2 size={14} />}
            {t('shotgrid.settings.linkProject')}
          </button>
        </>
      )}
    </section>
  );
}

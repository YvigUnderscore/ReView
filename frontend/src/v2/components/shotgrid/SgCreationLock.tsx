// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { ExternalLink, Lock } from 'lucide-react';
import { useT } from '../../i18n';
import { useSgConnection } from '../../lib/shotgridApi';

/**
 * Bandeau remplaçant les formulaires de création quand ShotGrid mène le projet.
 *
 * Le serveur refuse déjà la création — mais laisser le formulaire en place pour se
 * heurter à un refus n'apprend rien à personne. Ici on explique pourquoi, et on ouvre
 * le bon formulaire ShotGrid, pré-rempli sur le projet lié.
 *
 * `children` est rendu tel quel quand le verrou est levé : l'appelant enveloppe son
 * formulaire sans avoir à dupliquer la condition.
 */
const SG_ENTITY: Record<'sequence' | 'shot' | 'asset', string> = {
  sequence: 'Sequence',
  shot: 'Shot',
  asset: 'Asset',
};

export default function SgCreationLock({
  projectId,
  kind,
  children,
}: {
  projectId: number;
  kind: 'sequence' | 'shot' | 'asset';
  children: React.ReactNode;
}) {
  const t = useT();
  const { data: connection } = useSgConnection(projectId);

  if (!connection?.active || !connection.settings.lockLocalCreation) return <>{children}</>;

  const createUrl = `${connection.site.baseUrl.replace(/\/$/, '')}/new/${SG_ENTITY[kind]}?project=${connection.sgProjectId}`;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-secondary/30 p-3">
      <p className="flex items-start gap-2 text-sm">
        <Lock size={14} className="mt-0.5 shrink-0 text-muted-foreground" />
        <span>
          <span className="font-medium">{t('shotgrid.locked.title')}</span>
          <span className="block text-xs text-muted-foreground">{t('shotgrid.locked.body')}</span>
        </span>
      </p>
      <a
        href={createUrl}
        target="_blank"
        rel="noreferrer"
        className="flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm hover:bg-secondary/60"
      >
        {t('shotgrid.locked.open')} <ExternalLink size={13} />
      </a>
    </div>
  );
}

// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState, type ReactNode } from 'react';
import { Settings2 } from 'lucide-react';
import PageShell from '../PageShell';
import EntityBreadcrumb from '../EntityBreadcrumb';
import FavoriteButton from '../FavoriteButton';
import PipelineStatusBadge from '../shotgrid/PipelineStatusBadge';
import SgSyncDot from '../shotgrid/SgSyncDot';
import EntityContextMenu from '../ui/entity-menu';
import { separator, type MenuEntry } from '../../lib/menuSpec';
import EntitySettingsDialog from './EntitySettingsDialog';
import EntityHeaderPanel from './EntityHeaderPanel';
import EntityThumb from './EntityThumb';
import type { NoteKind } from '../../lib/notesApi';
import type { EntityKind, EntitySource } from './entitySettings';
import { useT } from '../../i18n';

/**
 * Coquille commune d'une séquence, d'un plan ou d'un asset (C3).
 *
 * Les trois pages du même travail — des étapes, des tâches, des versions — divergeaient
 * sans raison : le statut et la pastille de synchronisation manquaient sur un asset, la
 * vignette n'apparaissait nulle part sauf sur un plan, et une séquence n'avait pas de page
 * du tout. L'en-tête est désormais le même partout, et le clic droit y ouvre les réglages.
 */

const FAVORITE_TYPE: Record<EntityKind, 'SEQUENCE' | 'SHOT' | 'ASSET'> = {
  sequence: 'SEQUENCE',
  shot: 'SHOT',
  asset: 'ASSET',
};

/** Le segment d'URL de l'entité : l'API parle au pluriel, le composant au singulier. */
const NOTE_KIND: Record<EntityKind, NoteKind> = {
  sequence: 'sequences',
  shot: 'shots',
  asset: 'assets',
};

export default function EntityWorkPage({
  kind,
  id,
  projectId,
  title,
  subtitle,
  entity,
  thumbnailUrl,
  statusId,
  canManage,
  actions,
  menuExtras = [],
  children,
}: {
  kind: EntityKind;
  id: number;
  projectId: number;
  title: string;
  subtitle?: string | null;
  /** Ce que porte l'entité : alimente le panneau de réglages sans le recharger. */
  entity: EntitySource;
  thumbnailUrl?: string | null;
  statusId?: number | null;
  canManage: boolean;
  actions?: ReactNode;
  /** Entrées propres à l'entité (nouvelle version, playlist…), au-dessus des réglages. */
  menuExtras?: MenuEntry[];
  children: ReactNode;
}) {
  const t = useT();
  const [settingsOpen, setSettingsOpen] = useState(false);

  const entries: MenuEntry[] = [
    ...menuExtras,
    ...(menuExtras.length > 0 ? [separator('settings')] : []),
    ...(canManage
      ? [
          {
            id: 'settings',
            label: t('entity.settings.open'),
            icon: <Settings2 size={14} />,
            onSelect: () => setSettingsOpen(true),
          },
        ]
      : []),
  ];

  return (
    <PageShell breadcrumb={<EntityBreadcrumb entity={kind} id={id} />}>
      <EntityContextMenu entries={entries}>
        <div className="min-h-full">
          <header className="mb-5 flex flex-wrap items-start gap-4">
            {/* La place de l'image est toujours tenue : à défaut de miniature, le nom —
                la fiche garde sa forme, et le vide se voit assez pour donner envie d'en
                déposer une. */}
            <div className="h-24 w-40 shrink-0 overflow-hidden rounded-lg border border-border">
              <EntityThumb url={thumbnailUrl} name={title} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-xl font-semibold">{title}</h1>
                {statusId !== undefined && (
                  <PipelineStatusBadge statusId={statusId} scope={kind === 'asset' ? 'task' : kind} />
                )}
                <SgSyncDot projectId={projectId} type={kind} localId={id} canRealign={canManage} />
                <FavoriteButton type={FAVORITE_TYPE[kind]} entityId={id} size={18} />
              </div>
              {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {actions}
              {canManage && (
                <button
                  onClick={() => setSettingsOpen(true)}
                  title={t('entity.settings.open')}
                  aria-label={t('entity.settings.open')}
                  className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                >
                  <Settings2 size={16} />
                </button>
              )}
            </div>
          </header>

          {/* Équipe du périmètre et brief markdown — replié par défaut : on ouvre une
              page de plan pour voir son travail, pas sa fiche administrative. */}
          <EntityHeaderPanel kind={NOTE_KIND[kind]} id={id} projectId={projectId} canManage={canManage} />

          {children}
        </div>
      </EntityContextMenu>

      {settingsOpen && (
        <EntitySettingsDialog
          kind={kind}
          id={id}
          projectId={projectId}
          entity={entity}
          thumbnailUrl={thumbnailUrl}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </PageShell>
  );
}

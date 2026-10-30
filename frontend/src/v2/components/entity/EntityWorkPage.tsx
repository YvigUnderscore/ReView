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
 * Common shell of a sequence, shot or asset (C3).
 *
 * The three pages of the same work (steps, tasks, versions) diverged for no reason: the status and the sync dot
 * were missing on an asset, the thumbnail appeared nowhere but on a shot, and a sequence had no page at all. The
 * header is now the same everywhere, and right-click opens the settings there.
 */

const FAVORITE_TYPE: Record<EntityKind, 'SEQUENCE' | 'SHOT' | 'ASSET'> = {
  sequence: 'SEQUENCE',
  shot: 'SHOT',
  asset: 'ASSET',
};

/** The entity's URL segment: the API speaks in the plural, the component in the singular. */
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
  /** What the entity carries: feeds the settings panel without reloading it. */
  entity: EntitySource;
  thumbnailUrl?: string | null;
  statusId?: number | null;
  canManage: boolean;
  actions?: ReactNode;
  /** Entity-specific entries (new version, playlist…), shown above the settings. */
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
            {/* The image slot is always reserved: failing a thumbnail, the name. The card keeps its
                shape, and the empty slot is visible enough to make one want to add a thumbnail. */}
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

          {/* Team of the scope and markdown brief: collapsed by default. One opens a shot page to see its
              work, not its administrative sheet. */}
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

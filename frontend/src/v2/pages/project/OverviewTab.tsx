// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, LayoutGrid, Plus } from 'lucide-react';
import { qk } from '../../lib/query';
import EntityContextMenu from '../../components/ui/entity-menu';
import OverviewGrid from './overview/OverviewGrid';
import type { ProjectCounts } from './overview/CountsWidget';
import { overviewMenuEntries } from './overview/overviewMenu';
import { useOverviewLayout } from './overview/useOverviewLayout';
import {
  OVERVIEW_WIDGET_DEFS,
  addableOverviewWidgets,
  toggleOverviewWidget,
  visibleOverviewWidgets,
  type OverviewWidgetId,
} from './overview/overviewWidgets';
import { useT } from '../../i18n';

/**
 * Project overview: composable per person, on a default per role (batch 10).
 *
 * The page used to serve the same thing to everyone, in the same order: three counters, eight
 * thumbnails, a gauge, two columns. An artist looked there for what is asked of them and found it
 * nowhere; a supervisor had to open the Production tab to see what is blocking. Everyone now
 * chooses their blocks and their order, and the administration decides what someone who has chosen
 * nothing sees by default.
 *
 * One enters composition in two ways: right-click on the page background or on a block, and an
 * unobtrusive icon at the top of the page, because a menu one does not suspect does not exist.
 * Outside composition the page remains a page: no handle, and no button added to the blocks.
 */
export default function OverviewTab({
  name,
  projectId,
  counts,
  onGo,
}: {
  name: string;
  projectId: number;
  counts: ProjectCounts;
  onGo: (tab: string) => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const state = useOverviewLayout(projectId);
  const { layout, canManage, ready } = state;

  const show = (id: OverviewWidgetId) => state.save(toggleOverviewWidget(id, true, layout));
  const addable = addableOverviewWidgets(layout, canManage);
  // A page whose blocks are all hidden would offer nothing left to click, not even a background to
  // open the menu from. The catalogue then stays visible outside composition: it is the only way
  // back.
  const empty = visibleOverviewWidgets(layout, canManage).length === 0;

  const entries = overviewMenuEntries({
    t,
    editing,
    ready,
    layout,
    personalised: state.personal !== undefined,
    canManage,
    isAdmin: state.isAdmin,
    definedRoles: state.definedRoles,
    onToggleEdit: () => setEditing((v) => !v),
    onShow: show,
    onUseRoleDefault: state.useRoleDefault,
    onSaveRoleDefault: state.saveRoleDefault,
    onRefresh: () => {
      void qc.invalidateQueries({ queryKey: qk.projectActivity(projectId) });
      void qc.invalidateQueries({ queryKey: qk.projectMedia(projectId) });
    },
  });

  return (
    <EntityContextMenu entries={entries}>
      <div className="min-h-full">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">{t('overview.projectDashboard', { name })}</p>
          <button
            onClick={() => setEditing((v) => !v)}
            disabled={!ready}
            title={editing ? t('home.widget.editDone') : t('overview.customise')}
            aria-label={editing ? t('home.widget.editDone') : t('overview.customise')}
            className={`rounded-md p-2 transition-colors disabled:opacity-50 ${
              editing
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
            }`}
          >
            {editing ? <Check size={16} /> : <LayoutGrid size={16} />}
          </button>
        </div>

        <div className="space-y-6">
          <OverviewGrid
            projectId={projectId}
            counts={counts}
            canManage={canManage}
            layout={layout}
            editing={editing}
            onLayout={state.save}
            onHide={(id) => state.save(toggleOverviewWidget(id, false, layout))}
            onEnterEdit={() => setEditing(true)}
            onGo={onGo}
          />

          {/* Catalogue of removed blocks: in composition, or on a page that has been emptied. */}
          {(editing || empty) && addable.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-border p-3">
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Plus size={13} /> {t('home.widget.add')}
              </span>
              {addable.map((id) => (
                <button
                  key={id}
                  onClick={() => show(id)}
                  className="rounded-full border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground"
                >
                  {t(OVERVIEW_WIDGET_DEFS[id].labelKey)}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </EntityContextMenu>
  );
}

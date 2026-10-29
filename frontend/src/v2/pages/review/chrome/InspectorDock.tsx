// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReactNode } from 'react';
import { PanelRightClose } from 'lucide-react';
import { IconButton } from '@/v2/components/ui/icon-button';
import { RailButton } from './ToolRail';
import type { PanelId, ReviewPanel } from './panels';
import { useT } from '@/v2/i18n';

/**
 * Inspector dock — right column. Only one panel open at a time; clicking the open tab again closes
 * the body and leaves only the 44 px tab strip. Comments have their own column: they never mix with
 * the viewer settings.
 */
export default function InspectorDock({
  panels,
  panel,
  onPanel,
  children,
}: {
  panels: ReviewPanel[];
  panel: PanelId | null;
  onPanel: (panel: PanelId | null) => void;
  children: ReactNode;
}) {
  const t = useT();
  const open = panels.find((p) => p.id === panel);
  const OpenIcon = open?.icon;
  return (
    <div className="rv-dock">
      <div className="rv-dock__tabs">
        {panels.map((p) => (
          <RailButton
            key={p.id}
            icon={p.icon}
            label={t(p.labelKey)}
            active={panel === p.id}
            onClick={() => onPanel(panel === p.id ? null : p.id)}
          />
        ))}
      </div>
      {open && OpenIcon && (
        <div className="rv-dock__body">
          <div className="rv-dock__head">
            <OpenIcon size={15} className="text-primary" />
            <h3 className="rv-dock__title">{t(open.labelKey)}</h3>
            <span className="ml-auto">
              <IconButton
                icon={PanelRightClose}
                label={t('review.dock.collapse')}
                onClick={() => onPanel(null)}
              />
            </span>
          </div>
          <div className="rv-dock__scroll custom-scrollbar">{children}</div>
        </div>
      )}
    </div>
  );
}

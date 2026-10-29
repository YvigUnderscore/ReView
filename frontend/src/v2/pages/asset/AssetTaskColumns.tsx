// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReactNode } from 'react';
import { Layers } from 'lucide-react';
import { useDepartments } from '../../lib/departmentsApi';
import type { ViewMode } from '../../stores/useViewPref';
import { useT } from '../../i18n';

/**
 * An asset's departments, side by side.
 *
 * They used to be stacked: on an asset that goes through six steps, the page scrolled over three
 * screens before one had seen the last, and comparing two steps meant going back and forth. In columns, the whole
 * pipe fits in view — and a column reads like a queue, which is what it is.
 *
 * Two layouts, because neither suffices: **columns** to compare steps
 * (the common case), the **stack** for an asset that goes through only one or two but carries
 * many tasks, where six empty columns would waste width.
 *
 * The column header carries the department's image when it has one. Beyond six
 * steps, a colour dot no longer stands out; a logo does.
 */
export default function AssetTaskColumns({
  projectId,
  view,
  groups,
}: {
  projectId: number;
  view: ViewMode;
  /** One entry per department, in pipe order. */
  groups: { key: string | null; name: string; count: number; children: ReactNode }[];
}) {
  const t = useT();
  const { data: departments = [] } = useDepartments(projectId, projectId > 0);
  const decorationOf = (key: string | null) => departments.find((d) => d.key === key);

  const header = (group: (typeof groups)[number]) => {
    const department = decorationOf(group.key);
    return (
      <h3 className="flex items-center gap-2 text-xs font-semibold section-label text-muted-foreground">
        {department?.imageUrl ? (
          <img
            src={department.imageUrl}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-5 w-5 shrink-0 rounded object-cover"
          />
        ) : (
          <Layers
            size={13}
            className="shrink-0"
            style={department?.color ? { color: department.color } : undefined}
          />
        )}
        <span className="truncate">{group.name || t('pipeline.dept.none')}</span>
        <span className="shrink-0 font-normal normal-case">{group.count}</span>
      </h3>
    );
  };

  if (view === 'compact') {
    return (
      <div className="space-y-5">
        {groups.map((group) => (
          <section key={group.key ?? '__none__'}>
            <div className="mb-2">{header(group)}</div>
            {group.children}
          </section>
        ))}
      </div>
    );
  }

  return (
    // Horizontal scrolling rather than wrapping: twelve steps over three rows
    // read no better than over one, and a column's position would stop indicating
    // where one is in the pipe.
    <div className="flex gap-3 overflow-x-auto pb-2">
      {groups.map((group) => (
        <section
          key={group.key ?? '__none__'}
          className="flex w-72 shrink-0 flex-col rounded-lg border border-border bg-secondary/20"
          style={
            decorationOf(group.key)?.color
              ? { borderTop: `2px solid ${decorationOf(group.key)!.color!}` }
              : undefined
          }
        >
          <div className="border-b border-border px-2.5 py-2">{header(group)}</div>
          <div className="flex-1 space-y-2 p-2">{group.children}</div>
        </section>
      ))}
    </div>
  );
}

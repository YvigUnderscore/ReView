// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReactNode } from 'react';
import { Layers } from 'lucide-react';
import { useDepartments } from '../../lib/departmentsApi';
import type { ViewMode } from '../../stores/useViewPref';
import { useT } from '../../i18n';

/**
 * Les départements d'un asset, côte à côte.
 *
 * Ils étaient empilés : sur un asset qui traverse six étapes, la page défilait sur trois
 * écrans avant qu'on ait vu la dernière, et comparer deux étapes revenait à faire des
 * allers-retours. En colonnes, tout le pipe tient dans le champ de vision — et une colonne
 * se lit comme une file d'attente, ce qu'elle est.
 *
 * Deux dispositions, parce qu'aucune ne suffit : les **colonnes** pour comparer les étapes
 * (le cas courant), la **pile** pour un asset qui n'en traverse qu'une ou deux mais porte
 * beaucoup de tâches, où six colonnes vides gaspilleraient la largeur.
 *
 * L'en-tête de colonne porte l'image du département quand il en a une. Au-delà de six
 * étapes, une pastille de couleur ne se distingue plus ; un logo, si.
 */
export default function AssetTaskColumns({
  projectId,
  view,
  groups,
}: {
  projectId: number;
  view: ViewMode;
  /** Une entrée par département, dans l'ordre du pipe. */
  groups: { key: string | null; name: string; count: number; children: ReactNode }[];
}) {
  const t = useT();
  const { data: departments = [] } = useDepartments(projectId, projectId > 0);
  const decorationOf = (key: string | null) => departments.find((d) => d.key === key);

  const header = (group: (typeof groups)[number]) => {
    const department = decorationOf(group.key);
    return (
      <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
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
    // Défilement horizontal plutôt que retour à la ligne : douze étapes sur trois rangées
    // ne se lisent pas mieux que sur une, et la position d'une colonne cesserait d'indiquer
    // où l'on en est dans le pipe.
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

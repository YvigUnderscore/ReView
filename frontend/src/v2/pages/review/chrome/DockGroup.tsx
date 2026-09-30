// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useT } from '../../../i18n';

/**
 * Gabarit des `<Select>` du dock : la primitive est dimensionnée pour les formulaires, les
 * panneaux sont deux crans plus denses. Passé en `className` pour que `twMerge` remplace le
 * padding et la taille de texte par défaut.
 */
export const DOCK_SELECT = 'w-full px-1.5 py-[0.3125rem] text-xs';

/**
 * Primitives de contenu du dock inspecteur. Un panneau n'est qu'une suite de `Group`, et un
 * `Group` une suite de `Row` : libellé à gauche, contrôle à droite. Cette régularité est ce
 * qui rend les panneaux lisibles sans les parcourir — on ne compose rien d'autre ici.
 *
 * `collapsible` transforme le titre en bouton : c'est le titre lui-même qui plie le groupe,
 * pas une poignée ajoutée à côté. `action` reste à droite et hors du bouton — l'enregistrement
 * d'une vue ou l'armement de la mesure ne peuvent pas vivre dans le déclencheur du repli.
 */
export function Group({
  title,
  action,
  collapsible,
  defaultCollapsed,
  count,
  children,
}: {
  title: string;
  /** Action de l'en-tête du groupe, poussée à droite (ex. « enregistrer la vue courante »). */
  action?: ReactNode;
  /** Titre cliquable : le groupe se plie et se déplie. */
  collapsible?: boolean;
  /** Arrive replié (groupe long) — l'utilisateur garde la main ensuite. */
  defaultCollapsed?: boolean;
  /** Décompte affiché près du titre : ce que le groupe contient quand il est fermé. */
  count?: number;
  children: ReactNode;
}) {
  const t = useT();
  const [collapsed, setCollapsed] = useState(Boolean(collapsible && defaultCollapsed));
  const Chevron = collapsed ? ChevronRight : ChevronDown;
  return (
    <section className="rv-group">
      <h4 className="rv-group__title">
        {collapsible ? (
          <button
            type="button"
            aria-expanded={!collapsed}
            onClick={() => setCollapsed((v) => !v)}
            title={collapsed ? t('review.dock.group.expand') : t('review.dock.group.collapse')}
            className="flex min-w-0 flex-1 items-center gap-1 text-left uppercase transition-colors hover:text-foreground"
          >
            <Chevron size={12} className="shrink-0" />
            <span className="truncate">{title}</span>
            {count !== undefined && <span className="shrink-0 font-mono normal-case">{count}</span>}
          </button>
        ) : (
          title
        )}
        {action && <span className="ml-auto">{action}</span>}
      </h4>
      {!collapsed && children}
    </section>
  );
}

export function Row({
  label,
  hint,
  stack,
  children,
}: {
  label: ReactNode;
  hint?: string;
  /** Contrôle large (select, contrôle segmenté) : le libellé passe au-dessus. */
  stack?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={stack ? 'rv-row rv-row--stack' : 'rv-row'} title={hint}>
      <span className="rv-row__label">{label}</span>
      {children}
    </div>
  );
}

/** Ligne de lecture seule : un libellé, une valeur en chiffres — statistiques, fiche technique. */
export function ReadRow({ label, value, stack }: { label: string; value: ReactNode; stack?: boolean }) {
  return (
    <div className={stack ? 'rv-row rv-row--stack' : 'rv-row'}>
      <span className="rv-row__label">{label}</span>
      <span className={stack ? 'text-xs' : 'font-mono text-xs'}>{value}</span>
    </div>
  );
}

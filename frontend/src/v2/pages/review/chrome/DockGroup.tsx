// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReactNode } from 'react';

/**
 * Gabarit des `<Select>` du dock : la primitive est dimensionnée pour les formulaires, les
 * panneaux sont deux crans plus denses. Passé en `className` pour que `twMerge` remplace le
 * padding et la taille de texte par défaut.
 */
export const DOCK_SELECT = 'w-full px-1.5 py-[0.3125rem] text-xs';

/**
 * Primitives de contenu du dock inspecteur. Un panneau n'est qu'une suite de `Group`, et un
 * `Group` une suite de `Row` : libellé à gauche, contrôle à droite. Cette régularité est ce
 * qui rend les six panneaux lisibles sans les parcourir — on ne compose rien d'autre ici.
 */
export function Group({
  title,
  action,
  children,
}: {
  title: string;
  /** Action de l'en-tête du groupe, poussée à droite (ex. « enregistrer la vue courante »). */
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rv-group">
      <h4 className="rv-group__title">
        {title}
        {action && <span className="ml-auto">{action}</span>}
      </h4>
      {children}
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

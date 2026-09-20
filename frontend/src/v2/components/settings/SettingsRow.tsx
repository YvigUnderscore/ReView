// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReactNode } from 'react';
import { Hint } from '../ui/hint';

/**
 * Une ligne de réglage : son nom, son aide, son contrôle — la convention de libellé des
 * trois familles d'écrans.
 *
 * Il en existait trois : une étiquette de 256 px en colonne fixe dans l'administration, un
 * `Label` empilé au-dessus du champ dans le profil, une capitale grise sous le champ dans
 * les projets. La mesure de la colonne changeait donc d'un écran à l'autre, et l'aide
 * tantôt précédait le contrôle, tantôt le suivait.
 *
 * Le libellé n'est **pas** un `<label>` : cette ligne accueille aussi des groupes (contrôle
 * segmenté, paire de champs) qu'un `<label>` ne peut pas nommer sans mentir au lecteur
 * d'écran. Le contrôle porte son propre nom accessible — `Field` pour un champ unique,
 * `label` pour un `SegmentedControl`.
 */
export default function SettingsRow({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  /** Ce que le réglage change, quand le libellé ne suffit pas. */
  hint?: string;
  /**
   * `id` du contrôle quand la ligne n'en porte qu'un : le libellé devient alors un vrai
   * `<label>`, et le champ un champ nommé. Absent pour un groupe, qui se nomme lui-même.
   */
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        {htmlFor ? (
          <label className="text-sm" htmlFor={htmlFor}>
            {label}
          </label>
        ) : (
          <div className="text-sm">{label}</div>
        )}
        {hint && <Hint size="fine">{hint}</Hint>}
      </div>
      {children}
    </div>
  );
}

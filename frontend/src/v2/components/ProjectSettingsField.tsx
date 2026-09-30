// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReactNode } from 'react';

/**
 * Un libellé courant au-dessus de son champ, dans la graisse des panneaux de réglages.
 *
 * Les sections de réglages alignent trois ou quatre champs courts sur une même ligne : le
 * `<label>` enveloppe ici le contrôle, il n'y a donc aucun `htmlFor` à ne pas oublier. Le
 * `Field` de `ui/` reste le bon outil pour un formulaire en colonne, avec aide et erreur.
 */
export default function ProjectSettingsField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-2xs section-label text-muted-foreground">
      {label}
      {children}
    </label>
  );
}

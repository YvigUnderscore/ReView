// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { useT } from '../../i18n';
import type { AdminSectionKey } from './adminSections';

/**
 * Le renvoi vers l'écran qui fait autorité sur un réglage.
 *
 * Le même réglage se réglait à plusieurs endroits — la rétention de la corbeille dans
 * « Studio » et celle des journaux dans « Maintenance », le logo du studio dans
 * « Diffusion » alors que la page de connexion l'affiche aussi. Deux champs pour une seule
 * valeur, c'est une valeur qu'on croit avoir changée. Un seul écran la porte désormais ;
 * les autres disent où elle vit, et n'en proposent pas une seconde copie.
 */
export default function SettingsPointer({
  section,
  label,
  hint,
}: {
  /** Section qui fait autorité — sa clé **est** sa route. */
  section: AdminSectionKey;
  /** Nom de cette section, tel que la barre latérale l'affiche. */
  label: string;
  /** Ce que l'on y règle, dit dans les mots de l'écran courant. */
  hint?: string;
}) {
  const t = useT();
  return (
    <p className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
      {hint && <span>{hint}</span>}
      <Link
        to={`/admin/${section}`}
        className="inline-flex items-center gap-0.5 text-primary hover:underline"
      >
        {t('settings.setIn', { section: label })}
        <ArrowUpRight size={12} />
      </Link>
    </p>
  );
}

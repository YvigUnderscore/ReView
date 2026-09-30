// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useDepartments } from '../../lib/departmentsApi';
import { statusSwatch } from '../../lib/contrast';
import { useTheme } from '../../stores/useTheme';
import { useT } from '../../i18n';

/**
 * Départements que traverse une entité (B1, écran manquant jusqu'ici — C3).
 *
 * Le modèle, les routes et le service existaient depuis la vague B ; il n'y avait
 * simplement aucun endroit dans l'interface pour dire « cet asset passe par modélisation,
 * texturing et rig ». Les cases se cochent, la liste envoyée remplace la précédente.
 */
export default function EntityDepartmentsField({
  projectId,
  value,
  onChange,
  disabled,
}: {
  projectId: number;
  value: number[];
  onChange: (next: number[]) => void;
  disabled?: boolean;
}) {
  const t = useT();
  const isDark = useTheme((s) => s.theme) === 'dark';
  const { data: departments = [], isPending } = useDepartments(projectId);

  if (isPending) return <p className="text-xs text-muted-foreground">{t('common.loading')}</p>;
  if (departments.length === 0)
    return <p className="text-xs text-muted-foreground">{t('entity.settings.noDepartment')}</p>;

  const toggle = (id: number) =>
    onChange(value.includes(id) ? value.filter((d) => d !== id) : [...value, id]);

  return (
    <div className="flex flex-wrap gap-1.5">
      {departments.map((d) => {
        const on = value.includes(d.id);
        // La couleur du département vient de la base : on la normalise, sinon un jaune
        // clair posé en fond devient illisible sur le thème sombre.
        const swatch = d.color ? statusSwatch(d.color, isDark) : null;
        return (
          <button
            key={d.id}
            type="button"
            disabled={disabled}
            aria-pressed={on}
            onClick={() => toggle(d.id)}
            style={on && swatch ? swatch : undefined}
            className={`rounded-full border px-2.5 py-1 text-xs transition-colors disabled:opacity-50 ${
              on
                ? swatch
                  ? 'border-transparent'
                  : 'border-primary bg-primary/10 text-primary'
                : 'border-border text-muted-foreground hover:border-primary/60 hover:text-foreground'
            }`}
          >
            {d.name}
          </button>
        );
      })}
    </div>
  );
}

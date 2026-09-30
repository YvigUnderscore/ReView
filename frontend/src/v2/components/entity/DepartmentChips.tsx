// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DepartmentRef } from '../../types/entities';
import { useT } from '../../i18n';

/**
 * Les étapes que traverse une entité, sur sa carte.
 *
 * Elles étaient déclarées dans un panneau de réglages et n'apparaissaient nulle part
 * ailleurs : impossible de voir, en balayant une grille, quel asset passe par le rig et
 * lequel s'arrête au modeling. Or c'est exactement ce qu'un superviseur cherche à repérer.
 *
 * Une pastille par étape, teintée de sa couleur — celle du site quand il en fournit une,
 * donc la même ici que là-bas. Au-delà de quatre, un compteur : une carte n'a pas la
 * largeur d'un pipe entier, et douze pastilles ne se lisent pas mieux qu'un nombre.
 */
const MAX_SHOWN = 4;

export default function DepartmentChips({ departments }: { departments: DepartmentRef[] }) {
  const t = useT();
  if (departments.length === 0) return null;
  const shown = departments.slice(0, MAX_SHOWN);
  const hidden = departments.length - shown.length;

  return (
    <span
      className="flex flex-wrap items-center gap-1"
      title={departments.map((d) => d.name).join(' · ')}
      aria-label={t('pipeline.departments')}
    >
      {shown.map((department) => (
        <span
          key={department.id}
          className="rounded px-1 py-px text-2xs leading-tight"
          // La teinte vient du référentiel : « groom » est vert ici comme sur le site, et
          // le pipe se relit d'un coup d'œil entre les deux outils.
          style={
            department.color
              ? { backgroundColor: `${department.color}22`, color: department.color }
              : undefined
          }
        >
          {department.name}
        </span>
      ))}
      {hidden > 0 && <span className="text-2xs text-muted-foreground">+{hidden}</span>}
    </span>
  );
}

// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { AssetType, TaskType } from '../types/api';
import { hasMessage, type t as translate } from '../i18n';

/**
 * Libellés lisibles des deux enums que l'interface montrait tels quels.
 *
 * Les filtres de l'onglet Assets et du kanban affichaient `CHARACTER`, `PROP`,
 * `ENVIRONMENT`, `LOOKDEV` — des identifiants de base de données, en capitales, au milieu
 * d'une interface par ailleurs rédigée. Deux traitements différents, parce que ces deux
 * enums ne sont pas de même nature :
 *
 * - un **type d'asset** est un mot de la langue courante (personnage, accessoire, décor) :
 *   il se traduit ;
 * - un **type de tâche** est un nom de département, c'est-à-dire du vocabulaire de
 *   production que le glossaire du dépôt garde en anglais — et que le studio retrouve
 *   déjà écrit ainsi dans ses propres départements (« Look Dev », « Modeling »). On ne
 *   corrige donc que la casse, pour qu'il se lise comme le reste.
 */

/** `CHARACTER` → « Personnage » / « Character », selon la langue du lecteur. */
export function assetTypeLabel(t: typeof translate, type: AssetType | string): string {
  // Clé construite : un type inconnu (ancien projet, import) ne doit pas afficher la clé
  // elle-même — la casse normale du code reste plus lisible que `assetType.MACHIN`.
  const key = `assetType.${type}`;
  return hasMessage(key) ? t(key) : titleCase(type);
}

/** Noms de département : jamais traduits, seulement remis en casse normale. */
const TASK_TYPE_LABEL: Record<string, string> = {
  ANIMATION: 'Animation',
  FX: 'FX',
  COMPOSITING: 'Compositing',
  LIGHTING: 'Lighting',
  MODELING: 'Modeling',
  RIGGING: 'Rigging',
  LOOKDEV: 'Look Dev',
  LAYOUT: 'Layout',
};

export function taskTypeLabel(t: typeof translate, type: TaskType | string): string {
  // « Autre » n'est pas un nom de département : c'est un mot de la langue courante.
  if (type === 'OTHER') return t('assetType.OTHER');
  return TASK_TYPE_LABEL[type] ?? titleCase(type);
}

/** `LOOK_DEV` → « Look Dev ». Repli pour tout code que ces tables ne connaissent pas. */
export function titleCase(value: string): string {
  return value
    .toLocaleLowerCase()
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toLocaleUpperCase() + word.slice(1))
    .join(' ');
}

// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { AssetType, TaskType } from '../types/api';
import { hasMessage, type t as translate } from '../i18n';

/**
 * Readable labels for the two enums the interface used to display as-is.
 *
 * The Assets tab and kanban filters displayed `CHARACTER`, `PROP`, `ENVIRONMENT`, `LOOKDEV` — database
 * identifiers, in capitals, in the middle of an otherwise written interface. Two different treatments,
 * because these two enums are not of the same nature:
 *
 * - an **asset type** is a word of the current language (character, prop, set): it is translated;
 * - a **task type** is a department name, that is production vocabulary the repository glossary keeps
 *   in English — and that the studio already writes this way in its own departments ("Look Dev",
 *   "Modeling"). We therefore only correct the casing, so that it reads like the rest.
 */

/** `CHARACTER` → "Personnage" / "Character", depending on the reader's language. */
export function assetTypeLabel(t: typeof translate, type: AssetType | string): string {
  // Constructed key: an unknown type (old project, import) must not display the key itself —
  // normal casing of the code remains more readable than `assetType.MACHIN`.
  const key = `assetType.${type}`;
  return hasMessage(key) ? t(key) : titleCase(type);
}

/** Department names: never translated, only put back into normal casing. */
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
  // "Other" is not a department name: it is a word of the current language.
  if (type === 'OTHER') return t('assetType.OTHER');
  return TASK_TYPE_LABEL[type] ?? titleCase(type);
}

/** `LOOK_DEV` → "Look Dev". Fallback for any code these tables do not know. */
export function titleCase(value: string): string {
  return value
    .toLocaleLowerCase()
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toLocaleUpperCase() + word.slice(1))
    .join(' ');
}

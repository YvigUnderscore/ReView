// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { toast } from 'sonner';
import { t } from '../../../i18n';

/**
 * Avertit avant d'écraser une animation caméra existante (Phase 27) : toast non bloquant avec
 * action « Remplacer ». Utilisé par les presets (orbite) qui remplacent toutes les clés.
 */
export function confirmReplaceAnim(onConfirm: () => void): void {
  toast(t('camera.replaceAnim'), {
    description: t('camera.presetOverwrites'),
    action: { label: t('common.replace'), onClick: onConfirm },
  });
}

/** Avertit avant d'effacer la présentation persistée (caméra, animation, mise en scène). */
export function confirmClearPresentation(onConfirm: () => void): void {
  toast(t('camera.clearPresentation'), {
    description: t('camera.clearConfirm'),
    action: { label: t('common.delete'), onClick: onConfirm },
  });
}

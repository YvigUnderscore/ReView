// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { toast } from 'sonner';
import { t } from '@/v2/i18n';

/**
 * Warns before overwriting an existing camera animation (Phase 27): a non-blocking toast with a
 * "Replace" action. Used by the presets (orbit) that replace all keys.
 */
export function confirmReplaceAnim(onConfirm: () => void): void {
  toast(t('camera.replaceAnim'), {
    description: t('camera.presetOverwrites'),
    action: { label: t('common.replace'), onClick: onConfirm },
  });
}

/** Warns before erasing the persisted presentation (camera, animation, staging). */
export function confirmClearPresentation(onConfirm: () => void): void {
  toast(t('camera.clearPresentation'), {
    description: t('camera.clearConfirm'),
    action: { label: t('common.delete'), onClick: onConfirm },
  });
}

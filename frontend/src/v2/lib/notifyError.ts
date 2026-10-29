// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { toast } from 'sonner';
import { t } from '../i18n';

/** The message a failure should show: the error's own (already translated by apiClient), or the fallback. */
export function errorMessage(err: unknown, fallback: string = t('common.error.generic')): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/**
 * A user action failed: say so on screen, and leave the trace in the console.
 *
 * Several handlers used to end in `catch {}` — a deleted chat message that came back on the next
 * load, a reaction or a status change that silently did not happen. A gesture the user made
 * deserves an answer either way; this is the "no" one.
 */
export function notifyError(err: unknown, fallback?: string): void {
  console.error(err);
  toast.error(errorMessage(err, fallback));
}

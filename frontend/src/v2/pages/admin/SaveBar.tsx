// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Save } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { useT } from '../../i18n';

/**
 * The save bar of a settings screen: **one** per page, never one per field.
 *
 * It only arms itself if something has changed, and says so — this is what replaces the eleven
 * scattered buttons, none of which indicated which one was still to be pressed. "Discard
 * changes" only appears when there is something to discard.
 *
 * Sticky at the bottom of the column: on long screens (retention, project defaults) the
 * button stayed out of view at the very moment one had just changed something.
 */
export default function SaveBar({
  dirty,
  busy,
  onSave,
  onDiscard,
}: {
  dirty: boolean;
  busy: boolean;
  onSave: () => void;
  onDiscard: () => void;
}) {
  const t = useT();
  return (
    <div className="sticky bottom-0 z-10 mt-6 flex flex-wrap items-center gap-2 border-t border-border bg-background/95 py-3 backdrop-blur">
      <Button size="sm" disabled={!dirty || busy} onClick={onSave}>
        <Save size={14} /> {busy ? t('common.saving') : t('common.save')}
      </Button>
      {dirty && (
        <>
          <Button size="sm" variant="ghost" disabled={busy} onClick={onDiscard}>
            {t('settings.discardChanges')}
          </Button>
          <span className="text-xs text-muted-foreground">{t('settings.unsavedChanges')}</span>
        </>
      )}
    </div>
  );
}

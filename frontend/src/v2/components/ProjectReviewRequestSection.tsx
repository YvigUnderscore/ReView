// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Input } from './ui/input';
import { Switch } from './ui/switch';
import { MessageSquareText } from 'lucide-react';
import { Hint } from './ui/hint';
import { SettingsCard } from './settings/SettingsCard';
import { SETTINGS_KEYWORDS } from './settings/settingsKeywords';
import type { ReviewRequestRule } from '../types/api';
import { useT } from '../i18n';

/** The floor bounds, mirror of `lib/projectSettings` on the server. */
const MIN = 1;
const MAX = 280;

/**
 * What the project requires when someone is tagged as ReViewer of a media.
 *
 * Two settings, and a single gesture to understand: require the instruction, and say from
 * how many characters it counts as one. The second remains adjustable even when the first is
 * switched off: the floor applies to any written instruction, and a studio that imposes nothing
 * still wants to rule out "ok".
 *
 * Rendered in two places: the project's Settings tab, and the studio defaults it
 * inherits. One component for both, like the naming convention.
 */
export default function ProjectReviewRequestSection({
  value,
  onChange,
}: {
  value: ReviewRequestRule;
  onChange: (rule: ReviewRequestRule) => void;
}) {
  const t = useT();

  return (
    <SettingsCard
      title={t('reviewRequest.title')}
      hint={t('reviewRequest.hint')}
      icon={MessageSquareText}
      tone="info"
      keywords={SETTINGS_KEYWORDS.reviewRequest}
    >
      <div className="flex items-center justify-between gap-4">
        <label className="text-sm" htmlFor="review-request-require">
          {t('reviewRequest.require')}
          <span className="block text-xs text-muted-foreground">{t('reviewRequest.requireHint')}</span>
        </label>
        <Switch
          id="review-request-require"
          checked={value.requireNote}
          onCheckedChange={(requireNote) => onChange({ ...value, requireNote })}
          label={t('reviewRequest.require')}
        />
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-2xs section-label text-muted-foreground">
          {t('reviewRequest.minLength')}
          <Input
            type="number"
            min={MIN}
            max={MAX}
            className="w-24 py-1.5 text-xs"
            value={String(value.minNoteLength)}
            onChange={(e) =>
              onChange({
                ...value,
                // A field emptied by keyboard must not write `NaN` into the studio settings:
                // we fall back to the floor until the input resumes.
                minNoteLength: Math.min(Math.max(Number(e.target.value) || MIN, MIN), MAX),
              })
            }
          />
        </label>
        <Hint className="flex-1">{t('reviewRequest.minLengthHint')}</Hint>
      </div>
    </SettingsCard>
  );
}

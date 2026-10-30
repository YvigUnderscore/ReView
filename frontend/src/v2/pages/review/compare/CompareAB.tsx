// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { X } from 'lucide-react';
import { Button } from '@/v2/components/ui/button';
import { Select } from '@/v2/components/ui/select';
import type { CompareTarget } from './useCompareTargets';
import { useT } from '@/v2/i18n';

/**
 * A and B settings of the comparison, in the options bar of the "Compare" mode.
 *
 * A is the open media. B is chosen by version **then by media**: a version carrying several
 * images could only be compared through the first one. The choice used to live in a dock tab
 * that repeated the header without offering B.
 */
export default function CompareAB({
  aName,
  bId,
  targets,
  onSetB,
  onClear,
}: {
  aName: string;
  bId: number | null;
  targets: CompareTarget[];
  onSetB: (mediaId: number) => void;
  onClear: () => void;
}) {
  const t = useT();
  const groups = targets.filter((v) => v.media.length > 0);
  const known = groups.some((v) => v.media.some((m) => m.id === bId));

  return (
    <>
      <span className="rv-row__label" title={t('compare.slotA')}>
        A
      </span>
      <span className="max-w-48 truncate text-xs text-foreground" title={aName}>
        {aName}
      </span>
      <span className="rv-rule" />
      <span className="rv-row__label" title={t('compare.slotB')}>
        B
      </span>
      <Select
        aria-label={t('compare.slotB')}
        title={t('compare.slotB')}
        className="max-w-56 px-1.5 py-[0.1875rem] text-xs"
        value={bId == null ? '' : String(bId)}
        onChange={(e) => (e.target.value ? onSetB(Number(e.target.value)) : onClear())}
      >
        <option value="">{t('compare.noB')}</option>
        {/* B is already chosen but its details are still in flight: the missing option would empty the field. */}
        {bId != null && !known && <option value={bId}>{t('common.loading')}</option>}
        {groups.map((v) => (
          <optgroup key={v.versionId} label={v.name}>
            {v.media.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </optgroup>
        ))}
      </Select>
      {bId != null && (
        <Button size="sm" variant="ghost" onClick={onClear} title={t('review.compare.close')}>
          <X size={13} />
          {t('review.compare.close')}
        </Button>
      )}
    </>
  );
}

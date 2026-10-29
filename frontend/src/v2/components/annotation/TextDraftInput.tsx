// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useT } from '../../i18n';

/** Input of the text tool: HTML positioned in % of the media (the SVG viewBox would distort it).
 *  Valid entry, Escape cancels. */
export default function TextDraftInput({
  draft,
  onChangeValue,
  onCommit,
  onCancel,
}: {
  draft: { x: number; y: number; value: string };
  onChangeValue: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  return (
    <input
      // Deferred focus: the default focus of the original mousedown would steal it (blur → closed).
      ref={(el) => {
        if (el) setTimeout(() => el.focus(), 0);
      }}
      value={draft.value}
      placeholder={t('draw.textPlaceholder')}
      aria-label={t('draw.textPlaceholder')}
      onChange={(e) => onChangeValue(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') onCommit();
        if (e.key === 'Escape') onCancel();
      }}
      onBlur={onCommit}
      onPointerDown={(e) => e.stopPropagation()}
      className="absolute z-10 w-48 rounded border border-primary bg-background/90 px-1.5 py-0.5 text-sm text-foreground"
      style={{ left: `${draft.x * 100}%`, top: `${(draft.y - 0.02) * 100}%` }}
    />
  );
}

// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Pencil, Redo2, Trash2, Undo2 } from 'lucide-react';
import { RailButton } from '../review/chrome/ToolRail';
import { DRAW_TOOLS } from '../review/chrome/tools';
import type { Annotations } from '../review/useAnnotations';
import type { Tool } from '../../components/AnnotationCanvas';
import { USER_COLORS } from '../../lib/userColor';
import { useT } from '../../i18n';
import '../review/chrome/chrome.css';

/**
 * The drawing tools, for the guest.
 *
 * Nothing is rewritten here: these are the eight tools of the internal review (`DRAW_TOOLS`,
 * same labels, same shortcuts D/R/E/A/G/T/M/X), the same rail button and the same
 * stylesheet. The format written is that of the review — a client's feedback
 * reopens in the artist's review, and two diverging formats mean a drawing that
 * no longer displays six months later.
 *
 * The interface stays simple: the bar only appears on a link that allows feedback,
 * and only once drawing mode is armed — until then there is just a
 * button. A guest has neither a command palette nor a context menu (the right click already
 * serves free flight for the spatial viewers): the floating bar is here the last
 * resort, deliberately, not a reflex.
 */
export default function ClientAnnotationBar({ ann }: { ann: Annotations }) {
  const t = useT();

  if (!ann.annotating)
    return (
      <button
        type="button"
        onClick={() => ann.setAnnotating(true)}
        title={t('comments.annotate')}
        aria-label={t('comments.annotate')}
        className="flex w-fit items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <Pencil size={15} /> {t('comments.annotate')}
      </button>
    );

  return (
    <div className="rv-toolbar rounded-md border border-border bg-card p-1.5">
      {DRAW_TOOLS.map((tool) => (
        <RailButton
          key={tool.id}
          icon={tool.icon}
          label={t(tool.labelKey)}
          shortcut={tool.key}
          hint={t(tool.hintKey)}
          active={ann.tool === tool.id}
          onClick={() => ann.setTool(tool.id as Tool)}
        />
      ))}

      <div className="rv-rule" />

      {/* Ink: the application's dedicated palette, plus a free choice. These are
           data values (hexadecimal), not styling — the styling itself stays in
           theme tokens. */}
      <div className="flex items-center gap-1" role="group" aria-label={t('draw.ink')}>
        {/* Six inks, not twelve: the full palette made the bar wrap, and
             the free choice stays alongside for anyone who wants their own colour. */}
        {USER_COLORS.slice(0, 6).map((color) => (
          <button
            key={color}
            type="button"
            onClick={() => ann.setColor(color)}
            title={t('draw.ink')}
            aria-label={t('draw.ink')}
            aria-pressed={ann.color === color}
            style={{ backgroundColor: color }}
            className={`h-5 w-5 shrink-0 rounded-full border transition-transform ${
              ann.color === color ? 'scale-110 border-foreground' : 'border-border'
            }`}
          />
        ))}
        <input
          type="color"
          value={ann.color}
          onChange={(e) => ann.setColor(e.target.value)}
          title={t('draw.otherInk')}
          aria-label={t('draw.otherInk')}
          className="h-5 w-6 cursor-pointer rounded border border-border bg-transparent p-0"
        />
      </div>

      <label className="ml-1 flex items-center gap-1.5 text-xs text-muted-foreground">
        {t('review.thickness')}
        <input
          type="range"
          min={1}
          max={12}
          value={ann.penWidth}
          onChange={(e) => ann.setPenWidth(Number(e.target.value))}
          aria-label={t('review.thickness')}
          className="w-20 accent-primary"
        />
      </label>

      <div className="rv-rule" />

      <RailButton
        icon={Undo2}
        label={t('review.undoStroke')}
        onClick={ann.undo}
        className={ann.canUndo ? undefined : 'opacity-40'}
      />
      <RailButton
        icon={Redo2}
        label={t('common.redo')}
        onClick={ann.redo}
        className={ann.canRedo ? undefined : 'opacity-40'}
      />
      <RailButton icon={Trash2} label={t('draw.clearAll')} onClick={ann.clear} />

      <p className="ml-auto pr-1 text-2xs text-muted-foreground">{t('draw.goesWithComment')}</p>
    </div>
  );
}

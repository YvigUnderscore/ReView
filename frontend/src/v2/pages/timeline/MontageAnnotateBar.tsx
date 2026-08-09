// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { ArrowUpRight, Circle, Eraser, Pencil, Redo2, Square, Undo2 } from 'lucide-react';
import { USER_COLORS } from '../../lib/userColor';
import type { Tool } from '../../components/AnnotationCanvas';
import type { useAnnotations } from '../review/useAnnotations';
import { useT } from '../../i18n';

/**
 * Outils de dessin du montage (Phase 46).
 *
 * La review a les siens dans son rail ; ce bandeau leur répond en plus court, faute de
 * quoi le montage se commenterait à la seule couleur par défaut. Rien de plus que ce
 * qu'exige une note de coupe : un trait, une forme, une encre, et de quoi revenir en
 * arrière.
 */

/** Encres proposées d'emblée — mêmes teintes que la palette de review. */
const INK = [USER_COLORS[6], USER_COLORS[11], USER_COLORS[2], USER_COLORS[4], USER_COLORS[8]];

const TOOLS: { id: Tool; icon: typeof Pencil; key: 'draw' | 'arrow' | 'rect' | 'ellipse' }[] = [
  { id: 'draw', icon: Pencil, key: 'draw' },
  { id: 'arrow', icon: ArrowUpRight, key: 'arrow' },
  { id: 'rect', icon: Square, key: 'rect' },
  { id: 'ellipse', icon: Circle, key: 'ellipse' },
];

export default function MontageAnnotateBar({ ann }: { ann: ReturnType<typeof useAnnotations> }) {
  const t = useT();
  if (!ann.annotating) return null;

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border px-3 py-1.5">
      {TOOLS.map(({ id, icon: Icon, key }) => (
        <button
          key={id}
          onClick={() => ann.setTool(id)}
          title={t(`tool.${key}`)}
          className={`flex h-7 w-7 items-center justify-center rounded border ${
            ann.tool === id ? 'border-primary text-primary' : 'border-border text-muted-foreground'
          }`}
        >
          <Icon size={14} />
        </button>
      ))}

      <span className="mx-1 h-5 w-px bg-border" />
      {INK.map((ink) => (
        <button
          key={ink}
          onClick={() => ann.setColor(ink)}
          title={ink}
          style={{ backgroundColor: ink }}
          className={`h-5 w-5 rounded-full border-2 ${
            ann.color === ink ? 'border-foreground' : 'border-transparent'
          }`}
        />
      ))}

      <input
        type="range"
        min={1}
        max={12}
        step={1}
        value={ann.penWidth}
        onChange={(e) => ann.setPenWidth(Number(e.target.value))}
        title={t('review.thickness')}
        className="ml-1 h-1 w-20 accent-primary"
      />

      <span className="mx-1 h-5 w-px bg-border" />
      <button
        onClick={ann.undo}
        disabled={!ann.canUndo}
        title={t('common.undo')}
        className="flex h-7 w-7 items-center justify-center rounded border border-border text-muted-foreground disabled:opacity-40"
      >
        <Undo2 size={14} />
      </button>
      <button
        onClick={ann.redo}
        disabled={!ann.canRedo}
        title={t('common.redo')}
        className="flex h-7 w-7 items-center justify-center rounded border border-border text-muted-foreground disabled:opacity-40"
      >
        <Redo2 size={14} />
      </button>
      <button
        onClick={ann.clear}
        title={t('timeline.clearAnnotation')}
        className="flex h-7 w-7 items-center justify-center rounded border border-border text-muted-foreground"
      >
        <Eraser size={14} />
      </button>
    </div>
  );
}

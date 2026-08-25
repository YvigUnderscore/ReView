// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { parseNote, type NoteBlock } from './noteMarkdown';
import { renderNoteHtml } from './noteRender';
import NoteRefs from './NoteRefs';

/**
 * La fiche telle qu'on la lit.
 *
 * Rien n'y est calculé : `parseNote` a déjà décrit les blocs, ce composant les pose. La
 * séparation compte — l'analyse est testable sans DOM, et le rendu ne peut pas inventer une
 * règle de syntaxe que l'analyse ignorerait.
 */

/** Une jauge : le pourcentage se lit à la longueur, pas au chiffre. */
function Progress({ label, value }: { label: string; value: number }) {
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="truncate">{label}</span>
        <span className="shrink-0 tabular-nums text-muted-foreground">{Math.round(value)}%</span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuenow={Math.round(value)}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-1.5 overflow-hidden rounded-full bg-secondary"
      >
        <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

/** Une section dépliable : son état d'ouverture est local, il ne se persiste pas. */
function Section({ title, open, children }: { title: string; open: boolean; children: React.ReactNode }) {
  const [expanded, setExpanded] = useState(open);
  return (
    <section className="rounded-md border border-border">
      <button
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-sm font-medium hover:bg-secondary/40"
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        {title}
      </button>
      {expanded && <div className="space-y-3 border-t border-border px-2.5 py-2">{children}</div>}
    </section>
  );
}

/** Le markdown ordinaire — échappé et assaini par `renderNoteHtml`. */
function Markdown({ source }: { source: string }) {
  const html = useMemo(() => renderNoteHtml(source), [source]);
  return (
    <div
      className="prose-note text-sm leading-relaxed"
      // Le HTML brut est échappé et les protocoles exécutables retirés — cf. noteRender.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function Block({ block }: { block: NoteBlock }) {
  switch (block.kind) {
    case 'progress':
      return <Progress label={block.label} value={block.value} />;
    case 'small':
      return <p className="text-2xs text-muted-foreground">{block.text}</p>;
    case 'refs':
      return <NoteRefs images={block.images} />;
    case 'section':
      return (
        <Section title={block.title} open={block.open}>
          {block.blocks.map((child, i) => (
            <Block key={i} block={child} />
          ))}
        </Section>
      );
    case 'markdown':
      return <Markdown source={block.source} />;
  }
}

export default function NoteView({ source }: { source: string }) {
  const blocks = useMemo(() => parseNote(source), [source]);
  if (blocks.length === 0) return null;
  return (
    <div className="space-y-3">
      {blocks.map((block, i) => (
        <Block key={i} block={block} />
      ))}
    </div>
  );
}

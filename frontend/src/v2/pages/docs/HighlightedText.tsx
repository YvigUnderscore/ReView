// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Fragment, useMemo } from 'react';
import { matchSpans } from './docsHighlight';

/**
 * A table-of-contents label with the searched term highlighted.
 *
 * Same highlighting as in the body of the page, applied here to text that React renders
 * itself, such as a page or chapter title. The text remains text: no HTML is built, a string
 * is split into segments.
 */
export default function HighlightedText({ text, words }: { text: string; words: string[] }) {
  const segments = useMemo(() => {
    const spans = words.length > 0 ? matchSpans(text, words) : [];
    if (spans.length === 0) return null;

    const parts: { text: string; hit: boolean }[] = [];
    let cursor = 0;
    for (const span of spans) {
      if (span.start > cursor) parts.push({ text: text.slice(cursor, span.start), hit: false });
      parts.push({ text: text.slice(span.start, span.end), hit: true });
      cursor = span.end;
    }
    if (cursor < text.length) parts.push({ text: text.slice(cursor), hit: false });
    return parts;
  }, [text, words]);

  if (!segments) return <>{text}</>;
  return (
    <>
      {segments.map((part, index) => (
        <Fragment key={`${index}-${part.text}`}>
          {part.hit ? <mark className="doc-hit">{part.text}</mark> : part.text}
        </Fragment>
      ))}
    </>
  );
}

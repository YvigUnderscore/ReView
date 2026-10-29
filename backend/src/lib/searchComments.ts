// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Prisma, Role } from '@prisma/client';
import { prisma } from './prisma';

/**
 * Full-text search in the CONTENT of review comments.
 *
 * "The shot where the supervisor asked to remove the reflection" could not be found anywhere: global search only knew entity names. Review feedback
 * text, however, is the only trace of what was asked.
 *
 * Postgres is enough — no external engine. `to_tsvector('simple', content)` is GIN-indexed (migration `20260822120000_recherche_plein_texte_commentaires`),
 * and the query reuses EXACTLY the same expression, otherwise the index would not serve.
 *
 * Two choices to note:
 *
 *  • **`simple` configuration**, not `french`/`english`: the studio writes its feedback in fourteen languages and the column carries none. A stemming
 *    dictionary would err more often than it helps, and the index would become wrong the day someone comments in Japanese.
 *  • **`to_tsquery` with a `:*` prefix**, not `plainto_tsquery`: the palette searches on each keystroke, hence on unfinished words — `plainto_tsquery('simple', 'refl')`
 *    never returns anything until "reflet" is typed in full. The query string is built here from tokens reduced to letters and digits, then passed as a
 *    **bound parameter**: no user value enters the SQL text, and no tsquery operator (`&`, `|`, `!`, `<->`, parentheses) can survive the filtering.
 *
 * The HTML of the content is no hindrance: Postgres's default parser classifies tags as `tag` tokens, absent from the mapping table — so they are not indexed.
 */

/** A comment found, ready for the palette: an excerpt around the term, never the HTML. */
export interface CommentHit {
  id: number;
  mediaObjectId: number;
  excerpt: string;
  /** Displayable author (account, guest) or `null` if the account has been deleted. */
  authorName: string | null;
  createdAt: Date;
  /** Readable path: shot code or asset name, then media name. */
  context: string;
}

/** Maximum length of the excerpt returned (one palette line). */
const MAX_EXCERPT = 160;
/** Characters kept before the term found, so that the sentence keeps its beginning. */
const LEAD = 40;
/** Beyond it, the query is no longer a search but a sentence: we truncate. */
const MAX_TOKENS = 8;

/**
 * Splits the input into search tokens: letters and digits only, lowercase. Everything else (punctuation, tsquery operators, spaces) is a separator.
 */
export function searchTokens(q: string): string[] {
  return q
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 0)
    .slice(0, MAX_TOKENS);
}

/**
 * Matching `tsquery` string: all the tokens required, the last one as a prefix. `null` when the input contains no searchable character ("???").
 */
export function toTsQuery(q: string): string | null {
  const tokens = searchTokens(q);
  if (tokens.length === 0) return null;
  return tokens.map((w) => `${w}:*`).join(' & ');
}

/** HTML entities the rich editor produces — the only ones to undo in order to read the text. */
const ENTITIES: Readonly<Record<string, string>> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
};

/** Readable text of a comment content (rich editor HTML). */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&amp;|&lt;|&gt;|&quot;|&#39;/g, (e) => ENTITIES[e] ?? e)
    .replace(/\s+/g, ' ')
    .trim();
}

/** Excerpt centred on the first token found, bounded to one line. */
export function excerptAround(html: string, tokens: string[]): string {
  const text = htmlToPlainText(html);
  if (text.length <= MAX_EXCERPT) return text;
  const lower = text.toLowerCase();
  let at = -1;
  for (const token of tokens) {
    const i = lower.indexOf(token);
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  const start = at < 0 ? 0 : Math.max(0, at - LEAD);
  const end = Math.min(text.length, start + MAX_EXCERPT);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}

/** Raw row returned by the full-text query. */
interface CommentRow {
  id: number;
  mediaObjectId: number;
  content: string;
  createdAt: Date;
  guestName: string | null;
  username: string | null;
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  shotCode: string | null;
  assetName: string | null;
  originalName: string;
}

/**
 * Author's display name — **without a fallback on the email**, unlike `displayName()`. A search result is read by all the members of the project,
 * CLIENT accounts included: the studio's address directory has no business spilling into it line by line.
 */
function authorNameOf(row: CommentRow): string | null {
  if (row.username) return row.username;
  if (row.name) return row.name;
  const full = [row.firstName, row.lastName].filter(Boolean).join(' ').trim();
  if (full) return full;
  return row.guestName;
}

export interface CommentSearchScope {
  userId: number;
  role: Role;
  /** Accessible projects, or `null` for a global role (ADMIN/SUPERVISOR). */
  projectIds: number[] | null;
  limit: number;
}

/**
 * Comments accessible to the requester whose text answers the query.
 *
 * Partitioning is carried by the query itself, never by a filtering afterwards: accessible project, media not deleted and visible (a draft belongs
 * only to its uploader), and for a CLIENT only the notes marked `isVisibleToClient`.
 */
export async function searchComments(q: string, scope: CommentSearchScope): Promise<CommentHit[]> {
  const tsq = toTsQuery(q);
  if (!tsq) return [];
  // Non-global role with no project at all: nothing is accessible, no need to query.
  if (scope.projectIds !== null && scope.projectIds.length === 0) return [];

  const projectScope =
    scope.projectIds === null ? Prisma.empty : Prisma.sql`AND p."id" IN (${Prisma.join(scope.projectIds)})`;
  const isClient = scope.role === Role.CLIENT;
  const draftScope = isClient
    ? Prisma.sql`AND m."published" = true`
    : Prisma.sql`AND (m."published" = true OR m."uploaderId" = ${scope.userId})`;
  const clientScope = isClient ? Prisma.sql`AND c."isVisibleToClient" = true` : Prisma.empty;

  const rows = await prisma.$queryRaw<CommentRow[]>`
    SELECT c."id", c."mediaObjectId", c."content", c."createdAt", c."guestName",
           u."username", u."name", u."firstName", u."lastName",
           s."code" AS "shotCode", a."name" AS "assetName", m."originalName"
      FROM "Comment" c
      JOIN "MediaObject" m ON m."id" = c."mediaObjectId"
      JOIN "Version" v ON v."id" = m."versionId"
      LEFT JOIN "Task" t ON t."id" = v."taskId"
      LEFT JOIN "Shot" s ON s."id" = t."shotId"
      LEFT JOIN "Asset" a ON a."id" = COALESCE(v."assetId", t."assetId")
      JOIN "Project" p ON p."id" = COALESCE(s."projectId", a."projectId")
      LEFT JOIN "User" u ON u."id" = c."userId"
     WHERE to_tsvector('simple', c."content") @@ to_tsquery('simple', ${tsq})
       AND m."deletedAt" IS NULL
       AND v."deletedAt" IS NULL
       AND p."deletedAt" IS NULL
       AND (s."id" IS NULL OR s."deletedAt" IS NULL)
       AND (a."id" IS NULL OR a."deletedAt" IS NULL)
       ${draftScope}
       ${clientScope}
       ${projectScope}
     ORDER BY ts_rank(to_tsvector('simple', c."content"), to_tsquery('simple', ${tsq})) DESC,
              c."createdAt" DESC
     LIMIT ${scope.limit}
  `;

  const tokens = searchTokens(q);
  return rows.map((row) => ({
    id: row.id,
    mediaObjectId: row.mediaObjectId,
    excerpt: excerptAround(row.content, tokens),
    authorName: authorNameOf(row),
    createdAt: row.createdAt,
    context: [row.shotCode ?? row.assetName, row.originalName].filter(Boolean).join(' · '),
  }));
}

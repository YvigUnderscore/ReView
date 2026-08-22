// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Prisma, Role } from '@prisma/client';
import { prisma } from './prisma';

/**
 * Recherche plein texte dans le CONTENU des commentaires de review.
 *
 * « Le plan où le superviseur a demandé d'enlever le reflet » n'était trouvable nulle part :
 * la recherche globale ne connaissait que des noms d'entités. Le texte des retours est
 * pourtant la seule trace de ce qui a été demandé.
 *
 * Postgres suffit — aucun moteur externe. `to_tsvector('simple', content)` est indexé en GIN
 * (migration `20260822120000_recherche_plein_texte_commentaires`), et la requête réutilise
 * EXACTEMENT la même expression, sans quoi l'index ne servirait pas.
 *
 * Deux choix à retenir :
 *
 *  • **configuration `simple`**, pas `french`/`english` : le studio écrit ses retours dans
 *    quatorze langues et la colonne n'en porte aucune. Un dictionnaire de stemming se
 *    tromperait plus souvent qu'il n'aiderait, et l'index deviendrait faux le jour où
 *    quelqu'un commente en japonais.
 *  • **`to_tsquery` avec un préfixe `:*`**, pas `plainto_tsquery` : la palette cherche à
 *    chaque frappe, donc sur des mots inachevés — `plainto_tsquery('simple', 'refl')` ne
 *    rend jamais rien tant que « reflet » n'est pas tapé en entier. La chaîne de requête est
 *    construite ici à partir de tokens réduits aux lettres et aux chiffres, puis passée en
 *    **paramètre lié** : aucune valeur de l'utilisateur n'entre dans le texte SQL, et aucun
 *    opérateur de tsquery (`&`, `|`, `!`, `<->`, parenthèses) ne peut survivre au filtrage.
 *
 * Le HTML du contenu ne gêne pas : l'analyseur par défaut de Postgres classe les balises en
 * jetons `tag`, absents de la table de correspondance — elles ne sont donc pas indexées.
 */

/** Un commentaire trouvé, prêt pour la palette : extrait autour du terme, jamais le HTML. */
export interface CommentHit {
  id: number;
  mediaObjectId: number;
  excerpt: string;
  /** Auteur affichable (compte, invité) ou `null` si le compte a été supprimé. */
  authorName: string | null;
  createdAt: Date;
  /** Chemin lisible : code du shot ou nom de l'asset, puis nom du média. */
  context: string;
}

/** Longueur maximale de l'extrait rendu (une ligne de palette). */
const MAX_EXCERPT = 160;
/** Caractères conservés avant le terme trouvé, pour que la phrase garde son début. */
const LEAD = 40;
/** Au-delà, la requête n'est plus une recherche mais une phrase : on tronque. */
const MAX_TOKENS = 8;

/**
 * Découpe la saisie en tokens de recherche : lettres et chiffres uniquement, minuscules.
 * Tout le reste (ponctuation, opérateurs tsquery, espaces) est un séparateur.
 */
export function searchTokens(q: string): string[] {
  return q
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 0)
    .slice(0, MAX_TOKENS);
}

/**
 * Chaîne `tsquery` correspondante : tous les tokens exigés, le dernier en préfixe.
 * `null` quand la saisie ne contient aucun caractère cherchable (« ??? »).
 */
export function toTsQuery(q: string): string | null {
  const tokens = searchTokens(q);
  if (tokens.length === 0) return null;
  return tokens.map((w) => `${w}:*`).join(' & ');
}

/** Entités HTML que l'éditeur riche produit — les seules à défaire pour lire le texte. */
const ENTITIES: Readonly<Record<string, string>> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
};

/** Texte lisible d'un contenu de commentaire (HTML de l'éditeur riche). */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&amp;|&lt;|&gt;|&quot;|&#39;/g, (e) => ENTITIES[e] ?? e)
    .replace(/\s+/g, ' ')
    .trim();
}

/** Extrait centré sur le premier token trouvé, borné à une ligne. */
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

/** Ligne brute rendue par la requête plein texte. */
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
 * Nom d'affichage de l'auteur — **sans repli sur l'email**, contrairement à `displayName()`.
 * Un résultat de recherche est lu par tous les membres du projet, comptes CLIENT compris :
 * l'annuaire d'adresses du studio n'a pas à s'y déverser ligne par ligne.
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
  /** Projets accessibles, ou `null` pour un rôle global (ADMIN/SUPERVISOR). */
  projectIds: number[] | null;
  limit: number;
}

/**
 * Commentaires accessibles au demandeur dont le texte répond à la requête.
 *
 * Le cloisonnement est porté par la requête elle-même, jamais par un filtrage après coup :
 * projet accessible, média non supprimé et visible (un brouillon n'appartient qu'à son
 * déposant), et pour un CLIENT les seules notes marquées `isVisibleToClient`.
 */
export async function searchComments(q: string, scope: CommentSearchScope): Promise<CommentHit[]> {
  const tsq = toTsQuery(q);
  if (!tsq) return [];
  // Rôle non global sans aucun projet : rien n'est accessible, inutile d'interroger.
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

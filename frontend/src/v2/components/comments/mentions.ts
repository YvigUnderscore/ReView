import type { Membership } from '../../types/api';

/**
 * Helpers purs des mentions @user (32.B) : détection de la mention en cours de
 * saisie, filtrage des membres, insertion du jeton et surlignage au rendu.
 */

/** Candidat proposé par l'autocomplete : handle inséré dans le texte + libellé affiché. */
export interface MentionCandidate {
  id: number;
  handle: string;
  label: string;
}

/** Handle d'un membre : pseudo, sinon partie locale de l'email (matché côté backend). */
export function mentionHandle(user: { username?: string | null; email: string }): string {
  return user.username ?? user.email.split('@')[0]!;
}

export function toCandidates(members: Membership[]): MentionCandidate[] {
  return members.map((m) => ({
    id: m.user.id,
    handle: mentionHandle(m.user),
    label: m.user.name ?? m.user.email,
  }));
}

/**
 * Mention en cours de saisie : dernier `@` avant le caret, précédé d'un début de
 * ligne ou d'un séparateur, sans espace ni autre `@` entre lui et le caret.
 */
export function activeMentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const upto = text.slice(0, caret);
  const at = upto.lastIndexOf('@');
  if (at < 0) return null;
  if (at > 0 && !/[\s([{.,;:!?'"«»]/.test(upto[at - 1]!)) return null;
  const query = upto.slice(at + 1);
  if (/[\s@]/.test(query)) return null;
  return { start: at, query };
}

export function filterCandidates(candidates: MentionCandidate[], query: string): MentionCandidate[] {
  const q = query.toLowerCase();
  return candidates
    .filter((c) => c.handle.toLowerCase().startsWith(q) || c.label.toLowerCase().includes(q))
    .slice(0, 6);
}

/** Remplace la mention en cours par `@handle ` et renvoie le nouveau texte + caret. */
export function insertMention(
  text: string,
  caret: number,
  start: number,
  handle: string,
): { text: string; caret: number } {
  const next = `${text.slice(0, start)}@${handle} ${text.slice(caret)}`;
  return { text: next, caret: start + handle.length + 2 };
}

/**
 * Surligne les jetons `@xxx` d'un contenu HTML sanitisé sans toucher aux balises
 * (le texte est découpé sur les tags ; seuls les segments texte sont réécrits).
 */
export function highlightMentions(html: string): string {
  return html
    .split(/(<[^>]+>)/)
    .map((part) =>
      part.startsWith('<')
        ? part
        : part.replace(
            /(^|[\s([{.,;:!?'"«»])@([a-zA-Z0-9._-]+)/g,
            '$1<span class="text-primary font-medium">@$2</span>',
          ),
    )
    .join('');
}

// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Name of the next version.
 *
 * Two requirements meet here. First, never reuse a number: counting them ("there are 3 versions,
 * so the next is 4") regresses as soon as one is deleted, and produces two V03 that do not
 * designate the same work. So we start again from the highest number already taken, including by
 * a version put in the trash.
 *
 * Second, speak the same language as ShotGrid when the project is linked to it. A site names its
 * versions after the shot and the step that produces them (`DEMO_SH010_anim_v001`), and that is the
 * name production reads in its playlists and notes. A local "V02" in front of it forces everyone to
 * translate in their head. Outside a linked project, nothing changes.
 */

/** Number carried by a version name, whatever its convention. */
export function versionNumber(name: string): number | null {
  // `v001`, `V02`, `_v0001`: the number is what follows the last "v".
  const m = /v(\d+)\s*$/i.exec(name.trim());
  if (m) return Number.parseInt(m[1]!, 10);
  // Failing that, a name that ends in digits ("SH010_anim_3").
  const tail = /(\d+)\s*$/.exec(name.trim());
  return tail ? Number.parseInt(tail[1]!, 10) : null;
}

/** Next free number under a parent: above everything that has already been used. */
export function nextNumber(existing: readonly string[]): number {
  const used = existing.map(versionNumber).filter((n): n is number => n !== null);
  return used.length === 0 ? 1 : Math.max(...used) + 1;
}

export interface NamingContext {
  /** Shot code or asset name carrying the version. */
  parentCode?: string | null;
  /** Pipe step (the ShotGrid `step`, carried by `Task.department`). */
  step?: string | null;
  /** Names already taken under this parent, trash included. */
  existing: readonly string[];
  /** Is the project linked to a ShotGrid site? */
  linked: boolean;
}

/** Name fragment reduced to what a version code accepts. */
const slug = (value: string): string =>
  value
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^A-Za-z0-9_-]/g, '')
    .slice(0, 40);

/**
 * Does this name look like a code that came from the site?
 *
 * A local `V01` is not one: the long form is recognized by its `_v<n>` suffix.
 */
export function looksLikeSiteCode(name: string): boolean {
  return /_v\d+\s*$/i.test(name.trim());
}

/**
 * Replays the shape of an existing name with another number.
 *
 * We prefer to **imitate** the most advanced sibling rather than guess the studio's convention:
 * the project prefix (`DEMO_`), the case of the "v" and the padding width vary from one site to
 * another, and a version made up beside them would force production to translate in its head at
 * every playlist.
 */
export function bumpToNumber(model: string, n: number): string | null {
  const m = /^(.*?)(v)(\d+)(\s*)$/i.exec(model.trim());
  if (!m) return null;
  const [, prefix, v, digits] = m;
  return `${prefix}${v}${String(n).padStart(digits!.length, '0')}`;
}

export function nextVersionName(ctx: NamingContext): string {
  const n = nextNumber(ctx.existing);

  if (ctx.linked) {
    // The most advanced sibling that already carries a site code: its shape is authoritative.
    const model = [...ctx.existing]
      .filter(looksLikeSiteCode)
      .sort((a, b) => (versionNumber(a) ?? 0) - (versionNumber(b) ?? 0))
      .pop();
    const imitated = model ? bumpToNumber(model, n) : null;
    if (imitated) return imitated;

    // No model: usual ShotGrid convention, <parent>_<step>_v001. Without an identifiable parent,
    // we fall back to the short form, since "_anim_v001" designates nothing.
    if (ctx.parentCode) {
      const parts = [slug(ctx.parentCode), ctx.step ? slug(ctx.step) : null].filter(Boolean);
      return `${parts.join('_')}_v${String(n).padStart(3, '0')}`;
    }
  }
  return `V${String(n).padStart(2, '0')}`;
}

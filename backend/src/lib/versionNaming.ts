// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Nom de la version suivante.
 *
 * Deux exigences se rejoignent ici. D'abord ne jamais réutiliser un numéro : le compter
 * (« il y a 3 versions, la suivante est la 4 ») régresse dès qu'on en supprime une, et
 * fabrique deux V03 qui ne désignent pas le même travail. On repart donc du plus grand
 * numéro déjà porté, y compris par une version mise à la corbeille.
 *
 * Ensuite parler la même langue que ShotGrid quand le projet y est relié. Un site nomme
 * ses versions d'après le plan et l'étape qui les produit — `DEMO_SH010_anim_v001` — et
 * c'est ce nom que la production lit dans ses playlists et ses notes. Un « V02 » local
 * en face oblige chacun à traduire de tête. Hors projet relié, rien ne change.
 */

/** Numéro porté par un nom de version, quelle qu'en soit la convention. */
export function versionNumber(name: string): number | null {
  // `v001`, `V02`, `_v0001` : le numéro est ce qui suit le dernier « v ».
  const m = /v(\d+)\s*$/i.exec(name.trim());
  if (m) return Number.parseInt(m[1]!, 10);
  // À défaut, un nom qui se termine par des chiffres (« SH010_anim_3 »).
  const tail = /(\d+)\s*$/.exec(name.trim());
  return tail ? Number.parseInt(tail[1]!, 10) : null;
}

/** Prochain numéro libre sous un parent : au-dessus de tout ce qui a déjà servi. */
export function nextNumber(existing: readonly string[]): number {
  const used = existing.map(versionNumber).filter((n): n is number => n !== null);
  return used.length === 0 ? 1 : Math.max(...used) + 1;
}

export interface NamingContext {
  /** Code du plan ou nom de l'asset qui porte la version. */
  parentCode?: string | null;
  /** Étape du pipe (le `step` ShotGrid, porté par `Task.department`). */
  step?: string | null;
  /** Noms déjà pris sous ce parent, corbeille comprise. */
  existing: readonly string[];
  /** Le projet est-il relié à un site ShotGrid ? */
  linked: boolean;
}

/** Fragment de nom réduit à ce qu'un code de version accepte. */
const slug = (value: string): string =>
  value
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^A-Za-z0-9_-]/g, '')
    .slice(0, 40);

/**
 * Ce nom ressemble-t-il à un code venu du site ?
 *
 * Un `V01` local n'en est pas un : la forme longue se reconnaît à son suffixe `_v<n>`.
 */
export function looksLikeSiteCode(name: string): boolean {
  return /_v\d+\s*$/i.test(name.trim());
}

/**
 * Rejoue la forme d'un nom existant avec un autre numéro.
 *
 * On préfère **imiter** le frère le plus avancé plutôt que deviner la convention du
 * studio : le préfixe de projet (`DEMO_`), la casse du « v » et la largeur du padding
 * varient d'un site à l'autre, et une version fabriquée à côté de la plaque oblige la
 * production à traduire de tête à chaque playlist.
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
    // Le frère le plus avancé qui porte déjà un code du site : sa forme fait autorité.
    const model = [...ctx.existing]
      .filter(looksLikeSiteCode)
      .sort((a, b) => (versionNumber(a) ?? 0) - (versionNumber(b) ?? 0))
      .pop();
    const imitated = model ? bumpToNumber(model, n) : null;
    if (imitated) return imitated;

    // Aucun modèle : convention ShotGrid usuelle, <parent>_<étape>_v001. Sans parent
    // identifiable on retombe sur la forme courte, « _anim_v001 » ne désignant rien.
    if (ctx.parentCode) {
      const parts = [slug(ctx.parentCode), ctx.step ? slug(ctx.step) : null].filter(Boolean);
      return `${parts.join('_')}_v${String(n).padStart(3, '0')}`;
    }
  }
  return `V${String(n).padStart(2, '0')}`;
}

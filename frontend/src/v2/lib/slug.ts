/**
 * Slugs d'URL « parlants » (slug + id). Les routes restent résolues par l'**id**
 * (suffixe numérique) : le slug n'est que cosmétique et les anciens liens en pur-id
 * (`/review/219`) continuent de fonctionner. Aucune migration : le slug est dérivé du
 * nom déjà présent (projet, fichier média…) — jamais stocké.
 *
 * Exemples : `/projects/le-projet-demo-390`, `/review/perso-principal-v01-219`.
 */

// Plage des diacritiques combinants (U+0300–U+036F), retirés après normalisation NFD.
const DIACRITICS = new RegExp('[\\u0300-\\u036f]', 'g');

/** Normalise un texte en segment d'URL : sans accents, minuscule, mots séparés par des tirets. */
export function slugify(input: string | null | undefined): string {
  return (input ?? '')
    .normalize('NFD')
    .replace(DIACRITICS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, ''); // pas de tiret final après troncature
}

/** `nom-slugifie-{id}` (ou juste `{id}` si le nom ne produit aucun slug). */
export function entitySlug(name: string | null | undefined, id: number): string {
  const s = slugify(name);
  return s ? `${s}-${id}` : String(id);
}

/** Slug d'un média à partir de son nom de fichier (extension retirée). */
export function mediaSlug(originalName: string | null | undefined, id: number): string {
  const base = (originalName ?? '').replace(/\.[a-z0-9]{1,8}$/i, '');
  return entitySlug(base, id);
}

/**
 * Extrait l'id numérique d'un paramètre de route sluggé. L'id est toujours le dernier
 * groupe de chiffres (on l'ajoute en suffixe après un tiret). Tolère le pur-id.
 * Renvoie `NaN` si aucun chiffre — les appelants gèrent déjà l'id invalide.
 */
export function parseIdParam(param: string | null | undefined): number {
  if (!param) return NaN;
  const m = String(param).match(/(\d+)$/);
  return m ? Number(m[1]) : NaN;
}

/** Chemin client d'un projet (`/projects/{slug}`), avec suffixe optionnel (`/kanban`…). */
export function projectPath(project: { id: number; name?: string | null }, suffix = ''): string {
  return `/projects/${entitySlug(project.name, project.id)}${suffix}`;
}

/** Chemin client d'une review de média (`/review/{slug}`). */
export function reviewPath(media: { id: number; originalName?: string | null }): string {
  return `/review/${mediaSlug(media.originalName, media.id)}`;
}

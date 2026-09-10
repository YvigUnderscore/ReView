// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Le corps d'un commentaire est du **HTML** — c'est le format du produit, pas un accident :
 * l'éditeur en produit, `CommentItem` le rend, et l'import ShotGrid convertit ses notes vers
 * lui. Partout où un commentaire s'affiche en pleine largeur, ce HTML doit être rendu.
 *
 * Mais un aperçu d'une ligne ne peut pas le rendre : des balises de bloc dans une phrase
 * casseraient la mise en page. Il faut donc en extraire le texte — et l'oublier se voit tout
 * de suite, puisque le lecteur reçoit alors le balisage en toutes lettres. C'est ce que
 * l'accueil affichait : « <p><em>ShotGrid</em></p><p>The hero lands two frames late.</p> ».
 *
 * Ces aperçus vivaient dans le montage ; il y en a désormais deux, d'où ce module commun.
 */

/**
 * Texte nu d'un contenu déjà assaini.
 *
 * Les balises deviennent une espace plutôt que rien : `<p>a</p><p>b</p>` doit se lire
 * « a b » et non « ab ». Les espaces sont ensuite repliés, ce qui absorbe l'espace en trop
 * quand la balise en séparait déjà.
 */
export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Aperçu d'une ligne : texte nu, coupé sur une limite de mot.
 *
 * Couper au caractère près donne « The hero lands two fra… », qui se lit mal ; reculer
 * jusqu'à la dernière espace coûte quelques signes et rend la phrase.
 */
export function excerpt(html: string, max = 120): string {
  const texte = stripHtml(html);
  if (texte.length <= max) return texte;
  const coupe = texte.slice(0, max);
  const espace = coupe.lastIndexOf(' ');
  return `${(espace > max * 0.6 ? coupe.slice(0, espace) : coupe).trimEnd()}…`;
}

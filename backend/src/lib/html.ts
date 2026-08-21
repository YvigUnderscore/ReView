// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Échappement HTML, pour le peu de HTML que le serveur produit lui-même : les courriels,
 * la page de documentation d'API, la page de désabonnement.
 *
 * Une copie de cette fonction traînait dans chaque service de mail. Trois copies, c'est
 * trois occasions d'en oublier une — celle des guillemets, en général, qui est justement
 * celle qui compte dans un attribut.
 *
 * Contrat : la sortie est sûre dans un nœud de texte **et** dans un attribut, qu'il soit
 * entouré de guillemets doubles ou simples. Les six caractères sont donc traités en une
 * seule passe (une chaîne de `replace` réintroduit le risque d'oublier l'ordre de `&`) :
 * `&` `<` `>` `"` `'` et l'accent grave, que d'anciens moteurs traitent comme un délimiteur
 * d'attribut. `=` et `/` ne sont pas échappés : ils ne comptent que pour un attribut sans
 * guillemets — cas qu'on n'écrit pas — et les rendre illisibles abîmerait les URL.
 */

const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '`': '&#96;',
};

export const escapeHtml = (value: string): string => value.replace(/[&<>"'`]/g, (c) => ESCAPES[c]!);

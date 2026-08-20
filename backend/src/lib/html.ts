// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Échappement HTML, pour le peu de HTML que le serveur produit lui-même : les courriels,
 * la page de documentation d'API, la page de désabonnement.
 *
 * Une copie de cette fonction traînait dans chaque service de mail. Trois copies, c'est
 * trois occasions d'en oublier une — celle des guillemets, en général, qui est justement
 * celle qui compte dans un attribut.
 */
export const escapeHtml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

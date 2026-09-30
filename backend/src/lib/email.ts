// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Normalisation des adresses email à l'écriture.
 *
 * L'email est l'identifiant de connexion ET la clé de rapprochement du SSO OIDC (qui,
 * lui, reçoit toujours une adresse en minuscules du fournisseur). Sans normalisation,
 * `Alice@studio.com` et `alice@studio.com` sont deux comptes distincts que la contrainte
 * d'unicité ne rapproche pas : deux identités pour une même personne, et un rapprochement
 * SSO qui tombe sur la mauvaise. On normalise donc toute adresse au moment de l'écrire.
 *
 * Volontairement conservateur : minuscules + espaces retirés. Pas de retrait des points
 * ni des sous-adresses `+tag` — ces règles sont propres à certains fournisseurs et
 * fusionneraient à tort des adresses légitimement distinctes.
 */
export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

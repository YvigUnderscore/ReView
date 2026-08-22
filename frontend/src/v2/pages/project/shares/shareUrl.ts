// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/** URL publique d'un lien de partage, telle qu'on la copie ou l'envoie. */
export const clientUrl = (token: string): string => `${window.location.origin}/client/${token}`;

// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useState } from 'react';

/**
 * Le nom sous lequel un invité s'exprime, retenu sur son appareil.
 *
 * Un seul nom pour tout ce qu'il pose — sa note comme sa réponse. Deux états séparés
 * laissaient un client signer « Claire » son commentaire et « C. Martin » sa validation sur
 * le même plan, et c'est l'artiste qui devait deviner que c'était la même personne.
 *
 * L'écriture ne peut pas échouer bruyamment : navigation privée, stockage plein, site
 * bloqué — le nom vaut alors pour la session, ce qui est déjà l'essentiel.
 */
const STORAGE_KEY = 'client-guest-name';

const read = (): string => {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
};

export function useGuestName(): [string, (name: string) => void] {
  const [name, setName] = useState(read);
  const update = useCallback((next: string) => {
    setName(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* stockage indisponible : le nom vaut pour cette session */
    }
  }, []);
  return [name, update];
}

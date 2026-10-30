// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useState } from 'react';

/**
 * The name a guest speaks under, kept on their device.
 *
 * One name for everything they post: their note as well as their answer. Two separate states
 * let a client sign "Claire" on their comment and "C. Martin" on their validation for the same
 * shot, and the artist then had to guess it was the same person.
 *
 * The write cannot fail loudly: private browsing, full storage or a blocked site means the name
 * holds only for the session, which is already the essential part.
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
      /* Storage unavailable: the name holds for this session */
    }
  }, []);
  return [name, update];
}

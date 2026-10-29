// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * URL probe of the memory router.
 *
 * Mounted by `renderWithProviders`, it reports the current URL at each navigation: this is
 * how a test checks that a successful sign-in did leave `/login`, or that a
 * tab did get written into the query string. It is a separate file because it must export nothing
 * other than a component (hot reload).
 */
export function LocationSpy({ onChange }: { onChange: (path: string) => void }) {
  const location = useLocation();
  useEffect(() => {
    onChange(`${location.pathname}${location.search}`);
  }, [location, onChange]);
  return null;
}

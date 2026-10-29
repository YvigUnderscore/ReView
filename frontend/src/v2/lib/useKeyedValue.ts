// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';

/**
 * Returns `value` as it was when `key` last changed — a new identity only when the key does.
 *
 * For values rebuilt on every render (closures, entry builders) whose meaning is fully described
 * by a cheaper signature: a memoized consumer can depend on the result without listing — or
 * silencing — dependencies it cannot keep stable. The snapshot is taken during render (the
 * "adjust state on prop change" pattern), so the first render with a new key already sees it.
 */
export function useKeyedValue<T>(value: T, key: string | number): T {
  const [snapshot, setSnapshot] = useState(() => ({ key, value }));
  if (snapshot.key !== key) {
    setSnapshot({ key, value });
    return value;
  }
  return snapshot.value;
}

// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useMemo } from 'react';

/**
 * One `blob:` URL per pending file, in the same order, so that a thumbnail of what is being
 * attached can be shown.
 *
 * URLs are born in the `useMemo` and die in the cleanup of the effect that depends on it: if React
 * discards the memo and recomputes it, the effect replays and revokes exactly the batch it had
 * received. An unrevoked blob would keep its file in memory for the whole life of the tab.
 */
export function useObjectUrls(files: readonly File[]): string[] {
  const urls = useMemo(() => files.map((file) => URL.createObjectURL(file)), [files]);
  useEffect(() => () => urls.forEach((url) => URL.revokeObjectURL(url)), [urls]);
  return urls;
}

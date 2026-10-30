// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createContext } from 'react';

/**
 * Title / breadcrumb anchor node in the top bar (A1).
 *
 * Since `Shell` became a layout route, it is mounted once and for all and the pages live in its `<Outlet/>`: they can no
 * longer pass their title as a prop. They therefore project it through a portal into this node, via `PageShell`. It is
 * `null` until the first render (the node does not exist yet): consumers then render nothing.
 */
export const ShellHeaderContext = createContext<HTMLElement | null>(null);

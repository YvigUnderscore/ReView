// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ShellHeaderContext } from './shell/shellHeaderContext';
import { PageContainer, type PageWidth } from './ui/page';

/**
 * Page wrapper (A1): projects the title and breadcrumb into the top bar of
 * `Shell` and sets the width container.
 *
 * Replaces the former `<Shell title=… breadcrumb=…>` that each page rendered itself,
 * which unmounted the whole shell (sidebar, chat, socket, palette) on each navigation.
 */
export default function PageShell({
  title,
  breadcrumb,
  width = 'default',
  children,
}: {
  title?: string;
  breadcrumb?: ReactNode;
  width?: PageWidth;
  children: ReactNode;
}) {
  const headerEl = useContext(ShellHeaderContext);
  const header = breadcrumb ?? (
    <h1 className="truncate text-sm font-medium text-muted-foreground">{title ?? ''}</h1>
  );
  return (
    <>
      {headerEl != null && createPortal(header, headerEl)}
      <PageContainer width={width}>{children}</PageContainer>
    </>
  );
}

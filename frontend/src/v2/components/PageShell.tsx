// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ShellHeaderContext } from './shell/shellHeaderContext';
import { PageContainer, type PageWidth } from './ui/page';

/**
 * Enveloppe d'une page (A1) : projette le titre / fil d'Ariane dans la barre du haut de
 * `Shell` et pose le conteneur de largeur.
 *
 * Remplace l'ancien `<Shell title=… breadcrumb=…>` que chaque page rendait elle-même —
 * ce qui démontait toute la coquille (sidebar, chat, socket, palette) à chaque navigation.
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

// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { AuthorRef } from '../../types/api';
import { t } from '../../i18n';

/** Types partagés de la documentation (page + modal de création). */
export type DocScope = 'GLOBAL' | 'PROJECT' | 'SEQUENCE' | 'SHOT' | 'ASSET';
export type DocKind = 'RICH' | 'PDF';

export interface Doc {
  id: number;
  title: string;
  kind: DocKind;
  content: string | null;
  fileKey: string | null;
  fileUrl?: string | null;
  scope: DocScope;
  projectId: number | null;
  scopeId: number | null;
  createdBy: AuthorRef;
  updatedAt: string;
}

export const SCOPE_LABEL: Record<DocScope, string> = {
  GLOBAL: 'Global',
  PROJECT: 'Projet',
  SEQUENCE: t('entity.sequence'),
  SHOT: 'Shot',
  ASSET: 'Asset',
};

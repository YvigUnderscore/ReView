import type { AuthorRef } from '../../types/api';

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
  SEQUENCE: 'Séquence',
  SHOT: 'Shot',
  ASSET: 'Asset',
};

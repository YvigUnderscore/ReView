import type { MediaKind } from './api';

// ── Partage client (35.C/35.D) — module séparé de api.ts pour le budget de lignes ─
export type SharePermission = 'VIEW' | 'COMMENT';
/** GET /api/share?projectId= — lien de partage (le hash du mot de passe n'est jamais exposé). */
export interface ShareLink {
  id: number;
  token: string;
  projectId: number;
  permission: SharePermission;
  label: string | null;
  hasPassword: boolean;
  maxViews: number | null;
  viewCount: number;
  lastViewedAt: string | null;
  expiresAt: string | null;
  revoked: boolean;
  createdAt: string;
  createdBy: { id: number; name: string | null } | null;
}
/** Média tel qu'exposé sur la page client publique. */
export interface ClientMedia {
  id: number;
  kind: MediaKind;
  originalName: string;
  thumbnailUrl: string | null;
}
/** GET /api/client/:token — payload public (locked = mot de passe requis). */
export interface ClientSharePayload {
  locked: boolean;
  studio: { name: string; logoUrl: string | null };
  project?: { id: number; name: string; description: string | null; status: string };
  permission?: SharePermission;
  label?: string | null;
  media?: ClientMedia[];
  watermark?: { enabled: boolean; opacity: number };
  shareAuth?: string;
}
/** Commentaire tel qu'exposé côté client public. */
export interface ClientComment {
  id: number;
  content: string;
  timestamp: number | null;
  guestName: string | null;
  author: { id: number; name: string | null } | null;
  createdAt: string;
}
/** GET /api/admin/burnin — template studio des burn-ins/slates (35.A). */
export interface BurninConfig {
  enabled: boolean;
  showShot: boolean;
  showVersion: boolean;
  showTimecode: boolean;
  showLogo: boolean;
  customText: string;
  slate: boolean;
}

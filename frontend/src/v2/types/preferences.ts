/**
 * Préférences UI par compte — GET/PATCH /api/users/me/preferences (merge superficiel,
 * `null` = suppression de la clé). Sac ouvert : chaque feature y ajoute sa clé.
 */
export interface UserPreferences {
  /** Digest email quotidien (backlog P2). */
  emailDigest?: boolean;
  /** Dernière couleur d'annotation choisie en review. */
  annotationColor?: string;
  /** Vues kanban sauvegardées, clé = projectId (string). */
  kanbanViews?: Record<string, unknown>;
  /** Surcharges de raccourcis clavier globaux (42.A2) : id d'action → touche. */
  shortcuts?: Record<string, string>;
  [key: string]: unknown;
}

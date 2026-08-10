// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Préférences UI par compte — GET/PATCH /api/users/me/preferences (merge superficiel,
 * `null` = suppression de la clé). Sac ouvert : chaque feature y ajoute sa clé.
 */
export interface UserPreferences {
  /** Digest email quotidien (backlog P2). */
  emailDigest?: boolean;
  /** Rapport hebdomadaire de production par email (43.B — superviseurs/admins). */
  weeklyReport?: boolean;
  /** Dernière couleur d'annotation choisie en review. */
  annotationColor?: string;
  /** Vues kanban sauvegardées, clé = projectId (string). */
  kanbanViews?: Record<string, unknown>;
  /** Surcharges de raccourcis clavier globaux (42.A2) : id d'action → touche. */
  shortcuts?: Record<string, string>;
  /** Vues de liste sauvegardées (42.A5 — №73), clé = portée de la liste (ex. « reviews »). */
  savedViews?: Record<string, SavedView[]>;
  /** Tour d'onboarding vu (42.B — №69) : ne plus l'afficher automatiquement. */
  onboardingSeen?: boolean;
  /** Disposition de l'Accueil (refonte G) : blocs masqués et ordre par colonne. `null` = défaut. */
  homeWidgets?: { hidden?: string[]; order?: Partial<Record<'top' | 'main' | 'side', string[]>> } | null;
  /**
   * Langue de l'interface, code du registre i18n. Attachée au compte et non à l'appareil :
   * le serveur en a besoin pour envoyer les emails dans la bonne langue.
   */
  locale?: string;
  [key: string]: unknown;
}

/** Une vue de liste nommée : un jeu de filtres à rappeler en un clic. */
export interface SavedView {
  id: string;
  name: string;
  /** Filtres capturés (clé de filtre → valeur), propres à la portée de la liste. */
  filters: Record<string, string>;
}

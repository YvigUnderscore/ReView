// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { MediaKind, TaskStatus, TaskType } from '../../types/api';

/**
 * Réponses des deux vues transverses de « ce qui m'attend » :
 * `GET /api/dashboard/tasks` et `GET /api/dashboard/comments`.
 *
 * Elles déplient les compteurs de l'Accueil, et lisent côté serveur exactement le périmètre
 * de ceux-ci (`lib/homeScope`) : la page montre autant de lignes que la carte annonce.
 */

/** Une de mes tâches, avec son projet — la page est transverse, le projet fait partie du lieu. */
export interface MyTaskItem {
  id: number;
  name: string;
  type: TaskType;
  status: TaskStatus;
  location: string;
  projectId: number | null;
  projectName: string | null;
  dueDate: string | null;
}

/** Une note du fil des commentaires, de quoi la lire et ouvrir le média commenté. */
export interface CommentFeedItem {
  id: number;
  mediaId: number;
  mediaKind: MediaKind;
  mediaName: string;
  location: string;
  versionName: string;
  content: string;
  timestamp: number | null;
  createdAt: string;
  author: string | null;
}

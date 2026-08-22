// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { WEBHOOK_EVENTS, type WebhookEvent } from './webhooks';

/**
 * Ce qu'un webhook peut réellement recevoir.
 *
 * Le catalogue `WEBHOOK_EVENTS` sert de vocabulaire (types, `/api/v1/schema`), mais huit
 * de ses dix-huit noms n'ont jamais eu de point d'émission : un administrateur pouvait
 * s'abonner à `shot.created` ou à `media.failed` et attendre indéfiniment un appel qui ne
 * viendrait pas. Un abonnement qu'on ne peut pas honorer est pire qu'un événement absent —
 * il fait croire à une alerte branchée.
 *
 * `EMITTED_WEBHOOK_EVENTS` est donc la liste que l'administration propose et que la
 * validation accepte à la création d'un webhook ; `PHANTOM_WEBHOOK_EVENTS` recense ce qui
 * reste à câbler. Le test voisin relit les sources : si l'un des fantômes se met à être
 * publié, ou si un événement émis manque à la liste, la suite le dit.
 */

/** Événements réellement publiés par au moins un point du code (auditable, testé). */
export const EMITTED_WEBHOOK_EVENTS = [
  'media.published',
  'review.decision',
  'comment.created',
  'comment.resolved',
  'task.created',
  'task.updated',
  'task.status_changed',
  'task.assigned',
  'version.created',
  'version.published',
] as const satisfies readonly WebhookEvent[];

export type EmittedWebhookEvent = (typeof EMITTED_WEBHOOK_EVENTS)[number];

/**
 * Noms du catalogue sans point d'émission. Ils restent typés (un consommateur historique
 * peut les avoir en base) mais ne sont plus proposés ni acceptés à l'abonnement.
 *
 * Les câbler demande de toucher les services d'écriture correspondants
 * (`ProjectService`, `SequenceService`, `ShotService`, `AssetService`,
 * `MediaUploadService`, `workers/ffmpeg.worker`) : le jour où c'est fait, l'entrée passe
 * simplement dans `EMITTED_WEBHOOK_EVENTS`.
 */
export const PHANTOM_WEBHOOK_EVENTS = WEBHOOK_EVENTS.filter(
  (e): e is Exclude<WebhookEvent, EmittedWebhookEvent> =>
    !(EMITTED_WEBHOOK_EVENTS as readonly string[]).includes(e),
);

export const isEmittedWebhookEvent = (value: string): value is EmittedWebhookEvent =>
  (EMITTED_WEBHOOK_EVENTS as readonly string[]).includes(value);

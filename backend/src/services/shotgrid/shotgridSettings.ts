// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { z } from 'zod';
import { badRequest } from '../../lib/errors';
import { env } from '../../config/env';

/**
 * Réglages d'une connexion ShotGrid — schéma unique, validé à l'écriture comme à la
 * lecture. Une connexion créée avant l'ajout d'un réglage se lit avec sa valeur par
 * défaut : `parseSettings` complète toujours, ne rejette jamais un ancien objet.
 */

/** Domaines d'échange : chacun s'ouvre indépendamment en lecture et en écriture. */
export const SG_DOMAINS = [
  'hierarchy', // sequences / shots / assets
  'tasks',
  'statuses',
  'versions',
  'notes',
  'playlists',
  'users',
] as const;
export type SgDomain = (typeof SG_DOMAINS)[number];

const access = z.object({ read: z.boolean(), write: z.boolean() });

const domainsSchema = z.object({
  hierarchy: access.default({ read: true, write: true }),
  tasks: access.default({ read: true, write: true }),
  // Les statuts sont un référentiel : ReView les reçoit, ne les redéfinit pas côté SG.
  statuses: access.default({ read: true, write: false }),
  versions: access.default({ read: true, write: true }),
  notes: access.default({ read: true, write: true }),
  playlists: access.default({ read: true, write: true }),
  // Les comptes ne se créent jamais depuis la synchronisation (correspondance par email).
  users: access.default({ read: true, write: false }),
});

export const shotgridSettingsSchema = z.object({
  domains: domainsSchema.default({}),
  /** Création locale de sequences/shots/assets interdite tant que ShotGrid mène. */
  lockLocalCreation: z.boolean().default(true),
  eventMode: z.enum(['webhook', 'polling', 'manual']).default('webhook'),
  pollingIntervalSec: z.number().int().min(15).max(3600).default(60),
  /** Réconciliation périodique : rattrape ce qu'un webhook perdu ou une coupure a manqué. */
  reconcile: z
    .object({
      enabled: z.boolean().default(true),
      /** Heure locale du serveur (0-23) du passage complet. */
      hour: z.number().int().min(0).max(23).default(3),
      /** Fenêtre de re-lecture en heures : couvre une coupure plus longue qu'une nuit. */
      lookbackHours: z
        .number()
        .int()
        .min(1)
        .max(24 * 30)
        .default(72),
      /** Rattrapage immédiat au démarrage de l'instance (retour de coupure). */
      onBoot: z.boolean().default(true),
    })
    .default({}),
  media: z
    .object({
      source: z.enum(['transcoded', 'original']).default('transcoded'),
      autoImport: z.boolean().default(true),
      /** Codes de statut SG à importer ; vide = tous les publishes. */
      statusFilter: z.array(z.string()).default([]),
      maxSizeMo: z.number().int().min(1).max(200_000).nullable().default(null),
    })
    .default({}),
  push: z
    .object({
      /** Ce qu'une publication ReView crée côté ShotGrid. */
      publishMode: z.enum(['link', 'upload', 'off']).default('link'),
      /** Écrire au nom de l'utilisateur ReView (correspondance email) quand c'est possible. */
      attributeToUser: z.boolean().default(true),
      /** Joindre l'image annotée aux Notes poussées. */
      attachAnnotations: z.boolean().default(true),
    })
    .default({}),
  /** Correspondance code de statut SG (Version) → id de ReviewStatus ReView. */
  versionStatusMap: z.record(z.string(), z.number().int()).default({}),
  /**
   * Qui gagne quand les deux côtés ont bougé depuis la dernière synchronisation.
   * ShotGrid par défaut : c'est le registre de production de référence.
   */
  conflictPolicy: z.enum(['sg_wins', 'review_wins', 'manual']).default('sg_wins'),
});

export type ShotgridSettings = z.infer<typeof shotgridSettingsSchema>;

/** Réglages complets depuis la colonne JSON (tolère `{}` et les versions antérieures). */
export function parseSettings(raw: unknown): ShotgridSettings {
  const parsed = shotgridSettingsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : shotgridSettingsSchema.parse({});
}

/**
 * Réglages d'une connexion neuve : tout en lecture, rien en écriture.
 *
 * Le schéma ouvre l'écriture par défaut parce que c'est l'usage visé une fois
 * l'intégration en confiance. Mais au moment précis où l'on relie un projet, personne
 * n'a encore vérifié que la cible est la bonne — et un site ShotGrid de production ne
 * pardonne pas une première synchronisation qui écrit. On ouvre donc les écritures
 * après coup, explicitement.
 */
export function readOnlySettings(): ShotgridSettings {
  const base = shotgridSettingsSchema.parse({});
  const domains = Object.fromEntries(
    Object.entries(base.domains).map(([key, access]) => [key, { ...access, write: false }]),
  ) as ShotgridSettings['domains'];
  return { ...base, domains, push: { ...base.push, publishMode: 'off' } };
}

/** Le domaine est-il ouvert dans ce sens ? Toute lecture/écriture passe par là. */
export function can(settings: ShotgridSettings, domain: SgDomain, direction: 'read' | 'write'): boolean {
  return settings.domains[domain][direction];
}

/**
 * Validation de l'URL d'un site ShotGrid.
 *
 * Le serveur ira chercher cette adresse lui-même : sans garde-fou, un utilisateur
 * autorisé à configurer un site pourrait faire interroger le réseau interne
 * (métadonnées cloud, services d'administration). D'où l'exigence HTTPS et le rejet
 * des adresses littérales non routables. Les noms d'hôtes restent acceptés tels quels :
 * les résoudre ici n'empêcherait pas une réponse DNS différente au moment de l'appel.
 */
const PRIVATE_V4 =
  /^(0\.|10\.|127\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/;

/** Hôtes explicitement autorisés hors HTTPS public (simulateur de développement). */
function allowedInsecureHosts(): Set<string> {
  return new Set(
    (env.SHOTGRID_INSECURE_HOSTS ?? '')
      .split(',')
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function assertSafeBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw badRequest('URL de site ShotGrid invalide');
  }
  if (allowedInsecureHosts().has(url.host.toLowerCase())) return `${url.protocol}//${url.host}`;
  if (url.protocol !== 'https:') throw badRequest('Le site ShotGrid doit être en HTTPS');
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local'))
    throw badRequest('Hôte local refusé pour un site ShotGrid');
  if (PRIVATE_V4.test(host)) throw badRequest('Adresse IP privée refusée pour un site ShotGrid');
  // IPv6 littérale : bouclage (::1) et adresses locales uniques (fc00::/7, fe80::/10).
  if (host.startsWith('[')) {
    const v6 = host.slice(1, -1);
    if (v6 === '::1' || /^(f[cd]|fe8|fe9|fea|feb)/i.test(v6))
      throw badRequest('Adresse IPv6 locale refusée pour un site ShotGrid');
  }
  // Normalisation : pas de chemin, pas de barre finale — tout le reste est construit dessus.
  return `${url.protocol}//${url.host}`;
}

/** Lien profond vers la fiche d'une entité ShotGrid. */
export function sgDeepLink(baseUrl: string, sgType: string, sgId: number): string {
  return `${baseUrl.replace(/\/$/, '')}/detail/${sgType}/${sgId}`;
}

/** Lien de création pré-remplie côté ShotGrid (proposé quand la création locale est verrouillée). */
export function sgCreateLink(baseUrl: string, sgType: string, sgProjectId: number): string {
  return `${baseUrl.replace(/\/$/, '')}/new/${sgType}?project=${sgProjectId}`;
}

// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { z } from 'zod';
import { badRequest } from '../../lib/errors';
import { env } from '../../config/env';
import { logger } from '../../lib/logger';

/**
 * Settings of a ShotGrid connection: a single schema, validated on write as on read. A connection created before a setting was added reads with its default
 * value: `parseSettings` always completes, and never rejects an old object.
 */

/** Exchange domains: each opens independently for reading and for writing. */
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
  hierarchy: access.prefault({ read: true, write: true }),
  tasks: access.prefault({ read: true, write: true }),
  // Statuses are a reference: ReView receives them, it does not redefine them on the SG side.
  statuses: access.prefault({ read: true, write: false }),
  versions: access.prefault({ read: true, write: true }),
  notes: access.prefault({ read: true, write: true }),
  playlists: access.prefault({ read: true, write: true }),
  // Accounts are never created by the synchronization (matching by e-mail).
  users: access.prefault({ read: true, write: false }),
});

export const shotgridSettingsSchema = z.object({
  domains: domainsSchema.prefault({}),
  /** Local creation of sequences/shots/assets forbidden while ShotGrid leads. */
  lockLocalCreation: z.boolean().default(true),
  /**
   * Pipeline steps retained for this project, by ShotGrid identifier.
   *
   * ShotGrid restricts the proposed steps to those whose visibility is enabled in the project, but exposes it through no endpoint of its REST API. The studio therefore
   * declares here what its site knows without saying it. Empty list = deduce from the existing tasks, and failing that, offer the catalogue.
   */
  steps: z
    .object({
      asset: z.array(z.number().int().positive()).max(200).default([]),
      shot: z.array(z.number().int().positive()).max(200).default([]),
    })
    .prefault({}),
  /**
   * Statuses retained for this project, by scope and by ShotGrid code.
   *
   * A studio site offers twenty-one shot statuses; a given production uses only six. All twenty-one were displayed everywhere — context menus, columns, filters —
   * and one had to read them all to find the one of the day. The studio therefore declares here the ones it wants to see. Empty list = all, as before.
   *
   * Hiding erases nothing: the synchronization keeps importing the real status of an entity, and the badge of a shot already "on hold" stays correct. Only the choice is reduced.
   */
  visibleStatuses: z
    .object({
      task: z.array(z.string()).max(200).default([]),
      shot: z.array(z.string()).max(200).default([]),
      sequence: z.array(z.string()).max(200).default([]),
      asset: z.array(z.string()).max(200).default([]),
    })
    .prefault({}),
  eventMode: z.enum(['webhook', 'polling', 'manual']).default('webhook'),
  pollingIntervalSec: z.number().int().min(15).max(3600).default(60),
  /** Periodic reconciliation: catches up what a lost webhook or an outage missed. */
  reconcile: z
    .object({
      enabled: z.boolean().default(true),
      /** Server local time (0-23) of the full pass. */
      hour: z.number().int().min(0).max(23).default(3),
      /** Re-reading window in hours: covers an outage longer than one night. */
      lookbackHours: z
        .number()
        .int()
        .min(1)
        .max(24 * 30)
        .default(72),
      /** Immediate catch-up at instance startup (return from an outage). */
      onBoot: z.boolean().default(true),
    })
    .prefault({}),
  media: z
    .object({
      source: z.enum(['transcoded', 'original']).default('transcoded'),
      autoImport: z.boolean().default(true),
      /** ShotGrid status codes to import; empty = all publishes. */
      statusFilter: z.array(z.string()).default([]),
      maxSizeMo: z.number().int().min(1).max(200_000).nullable().default(null),
      /**
       * How to name the imported media.
       *
       * `sgCode`: the code of the ShotGrid Version — the name the production reads in its playlists and says during dailies. `filename`: the name of the delivered file,
       * useful to studios whose file convention carries information (colour space, encoding) that the code does not reproduce.
       */
      naming: z.enum(['sgCode', 'filename']).default('sgCode'),
      /**
       * Fetch the thumbnail carried by a sequence, a shot or an asset from the site.
       *
       * It is the picture that production recognizes: it is chosen in ShotGrid, it illustrates the shot in all its lists, and ReView used to display an empty card
       * until a published media eventually provided one. The transfer is an image of a few kilobytes per entity, and it only goes when the thumbnail has really changed on the site side.
       */
      thumbnails: z.boolean().default(true),
    })
    .prefault({}),
  push: z
    .object({
      /** What a ReView publication creates on the ShotGrid side. */
      publishMode: z.enum(['link', 'upload', 'off']).default('link'),
      /** Write in the name of the ReView user (e-mail match) when possible. */
      attributeToUser: z.boolean().default(true),
      /** Attach the annotated image to the pushed Notes. */
      attachAnnotations: z.boolean().default(true),
    })
    .prefault({}),
  /**
   * Who writes the description of a sequence, a shot or an asset.
   *
   * By default, ShotGrid: it is the production registry, the description is entered there and ReView copies it. It is then **read-only here** — letting an artist edit it
   * in ReView would produce a divergence that no synchronization could arbitrate, and that the next pass would overwrite without saying so.
   *
   * `writeBack` opens the round trip: ReView becomes editable again, and the modified description goes back up to the site. It is an explicit choice of the studio, not a default — writing
   * into a production site is not decided on its behalf.
   */
  descriptions: z
    .object({
      /** `shotgrid` = the site is authoritative (read-only here); `review` = ReView is authoritative. */
      source: z.enum(['shotgrid', 'review']).default('shotgrid'),
      /** Send the description modified in ReView back to the site. */
      writeBack: z.boolean().default(false),
    })
    .prefault({}),
  /** SG Version status code -> ReView ReviewStatus identifier match. */
  versionStatusMap: z.record(z.string(), z.number().int()).prefault({}),
  /**
   * Who wins when both sides have moved since the last synchronization.
   * ShotGrid by default: it is the reference production registry.
   */
  conflictPolicy: z.enum(['sg_wins', 'review_wins', 'manual']).default('sg_wins'),
});

export type ShotgridSettings = z.infer<typeof shotgridSettingsSchema>;

/**
 * Complete settings from the JSON column (tolerates `{}` and earlier versions).
 *
 * The fallback is **closed for writing**, never open. It used to fall back on the schema defaults, where every domain is `{ read: true, write: true }`: unreadable settings
 * (changed schema, corrupt JSON, unknown field) therefore returned to the caller an authorization to write into a production site that nobody had given — exactly the opposite of
 * `readOnlySettings()`, which closes everything at the moment a project is linked.
 *
 * We still save the readable sections one by one: discarding `versionStatusMap` or `steps` because another section is invalid would cut matches the studio had actually configured.
 */
export function parseSettings(raw: unknown): ShotgridSettings {
  const parsed = shotgridSettingsSchema.safeParse(raw ?? {});
  if (parsed.success) return parsed.data;
  logger.warn(
    { error: parsed.error.issues[0]?.message },
    'Réglages ShotGrid illisibles : repli en lecture seule',
  );
  const safe = readOnlySettings();
  if (raw && typeof raw === 'object') {
    // Section by section: what validates on its own is kept, the rest keeps the fallback.
    const source = raw as Record<string, unknown>;
    for (const key of [
      'media',
      'push',
      'reconcile',
      'steps',
      'visibleStatuses',
      'versionStatusMap',
      'descriptions',
    ] as const) {
      const section = shotgridSettingsSchema.shape[key].safeParse(source[key]);
      if (section.success) (safe as Record<string, unknown>)[key] = section.data;
    }
    const policy = shotgridSettingsSchema.shape.conflictPolicy.safeParse(source.conflictPolicy);
    if (policy.success) safe.conflictPolicy = policy.data;
    // The fallback is closed for writing, without exception: the `descriptions` section may be recovered for its `source`, never to reopen the send-back to the site.
    safe.descriptions = { ...safe.descriptions, writeBack: false };
    // `domains` is reintegrated domain by domain, and never beyond what the fallback allows: a doubtful section must not reopen a write.
    const domains = source.domains;
    if (domains && typeof domains === 'object') {
      for (const [name, value] of Object.entries(domains as Record<string, unknown>)) {
        const parsedAccess = access.safeParse(value);
        if (parsedAccess.success && name in safe.domains) {
          (safe.domains as Record<string, { read: boolean; write: boolean }>)[name] = {
            read: parsedAccess.data.read,
            write: false,
          };
        }
      }
    }
  }
  return safe;
}

/**
 * Settings of a new connection: everything in reading, nothing in writing.
 *
 * The schema opens writing by default because that is the intended use once the integration is trusted. But at the very moment a project is linked, nobody has yet
 * verified that the target is the right one — and a production ShotGrid site does not forgive a first synchronization that writes. Writes are therefore opened afterwards,
 * explicitly.
 */
export function readOnlySettings(): ShotgridSettings {
  const base = shotgridSettingsSchema.parse({});
  const domains = Object.fromEntries(
    Object.entries(base.domains).map(([key, access]) => [key, { ...access, write: false }]),
  ) as ShotgridSettings['domains'];
  return { ...base, domains, push: { ...base.push, publishMode: 'off' } };
}

/** Is the domain open in this direction? Every read/write goes through here. */
export function can(settings: ShotgridSettings, domain: SgDomain, direction: 'read' | 'write'): boolean {
  return settings.domains[domain][direction];
}

/**
 * Validation of a ShotGrid site's URL.
 *
 * The server will fetch this address itself: without a safeguard, a user authorized to configure a site could have the internal network queried
 * (cloud metadata, administration services). Hence the HTTPS requirement and the rejection of non-routable literal addresses. Host names remain accepted as they are:
 * resolving them here would not prevent a different DNS answer at the time of the call.
 */
const PRIVATE_V4 =
  /^(0\.|10\.|127\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/;

/** Hosts explicitly allowed outside public HTTPS (development simulator). */
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
    throw badRequest('Invalid ShotGrid site URL');
  }
  if (allowedInsecureHosts().has(url.host.toLowerCase())) return `${url.protocol}//${url.host}`;
  if (url.protocol !== 'https:') throw badRequest('The ShotGrid site must use HTTPS');
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local'))
    throw badRequest('A ShotGrid site cannot be a local host');
  if (PRIVATE_V4.test(host)) throw badRequest('A ShotGrid site cannot be a private IP address');
  // Literal IPv6: loopback (::1) and unique local addresses (fc00::/7, fe80::/10).
  if (host.startsWith('[')) {
    const v6 = host.slice(1, -1);
    if (v6 === '::1' || /^(f[cd]|fe8|fe9|fea|feb)/i.test(v6))
      throw badRequest('A ShotGrid site cannot be a local IPv6 address');
  }
  // Normalization: no path, no trailing slash — everything else is built on top of it.
  return `${url.protocol}//${url.host}`;
}

/** Deep link to the record of a ShotGrid entity. */
export function sgDeepLink(baseUrl: string, sgType: string, sgId: number): string {
  return `${baseUrl.replace(/\/$/, '')}/detail/${sgType}/${sgId}`;
}

/** Creation link pre-filled on the ShotGrid side (offered when local creation is locked). */
export function sgCreateLink(baseUrl: string, sgType: string, sgProjectId: number): string {
  return `${baseUrl.replace(/\/$/, '')}/new/${sgType}?project=${sgProjectId}`;
}

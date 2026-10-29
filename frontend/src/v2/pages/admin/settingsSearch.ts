// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { SETTINGS_HOMES, fieldsFor, type SettingsHome } from './studioSettings';
import { fold, haystack, matchesQuery } from '../../components/settings/settingsFilter';
import type { MessageKey } from '../../i18n';

/**
 * Search in the studio settings.
 *
 * Twenty-eight sections spread across five groups: to find the watermark you had to
 * know it lives in "Distribution", and for log retention that it is not
 * in the same place as trash retention. The search therefore covers the **setting
 * labels**, not only the section names.
 *
 * Two indexes are added together:
 *   1. `SECTION_KEYWORDS`: the words used to refer to a section;
 *   2. `SECTION_SETTING_LABELS`: the settings the section **actually** renders.
 *
 * The second was almost entirely missing: only the twelve key/value settings of
 * `studioSettings` were indexed, out of some sixty actually rendered. Searching for
 * "CRF", "slate", "STARTTLS", "batch size" or "scopes" found nothing:
 * exactly the settings one never remembers.
 *
 * The engine (accent folding, all required words) is that of the three families
 * of screens: `components/settings/settingsFilter`.
 */

export { fold };

/**
 * Extra keywords per section, in addition to its translated label.
 *
 * Deliberately in English **and** in French: a French-speaking studio searches for "filigrane"
 * as much as "watermark", and production terms stay in English everywhere.
 */
export const SECTION_KEYWORDS: Record<string, string[]> = {
  overview: ['dashboard', 'tableau de bord', 'statistiques', 'stats'],
  activity: ['audit', 'journal', 'log', 'historique', 'history', 'trace'],
  identity: [
    'sso',
    'oidc',
    'google',
    'saml',
    'ldap',
    'connexion',
    'login',
    'mot de passe',
    'password',
    '2fa',
  ],
  'login-appearance': ['login', 'connexion', 'fond', 'background', 'logo', 'accroche', 'tagline'],
  system: ['systeme', 'cpu', 'memoire', 'memory', 'disque', 'disk', 'sante', 'health', 'licence', 'license'],
  settings: [
    'reglages',
    'settings',
    'studio',
    'nom',
    'name',
    'marque',
    'brand',
    'logo',
    'langue',
    'language',
    'accent',
    'theme',
    'source',
    'agpl',
  ],
  defaults: [
    'defauts',
    'defaults',
    'nomenclature',
    'prefixe',
    'prefix',
    'resolution',
    'cadence',
    'fps',
    'departement',
    'department',
    'brouillon',
    'draft',
    'publication',
    'publish',
    'consigne',
    'brief',
  ],
  users: ['utilisateurs', 'users', 'comptes', 'accounts', 'roles', 'invitation', 'invite'],
  projects: ['projets', 'projects', 'archive', 'quota'],
  versions: ['versions', 'publication', 'publish', 'decision'],
  comments: ['commentaires', 'comments', 'notes', 'annotations'],
  storage: [
    'stockage',
    'storage',
    'minio',
    's3',
    'bucket',
    'derives',
    'derived',
    'quarantaine',
    'quarantine',
  ],
  visibility: ['masque', 'hidden', 'visibility', 'regle', 'rule', 'filtre', 'filter'],
  hdri: ['3d', 'splat', 'hdri', 'eclairage', 'lighting', 'environnement', 'environment'],
  ocio: ['couleur', 'color', 'ocio', 'aces', 'lut', 'display', 'view', 'colorspace'],
  video: [
    'video',
    'transcodage',
    'transcode',
    'hls',
    'proxy',
    'crf',
    'x264',
    'encodage',
    'encoding',
    'rendition',
  ],
  distribution: [
    'diffusion',
    'watermark',
    'filigrane',
    'burn-in',
    'burnin',
    'slate',
    'logo',
    'partage',
    'share',
  ],
  'review-statuses': ['statuts', 'status', 'decision', 'review', 'approbation', 'approval', 'retake'],
  announcements: ['annonces', 'announcements', 'message', 'banniere', 'banner'],
  smtp: ['smtp', 'email', 'mail', 'courriel', 'expediteur', 'sender', 'starttls', 'relais', 'relay'],
  api: ['api', 'webhook', 'token', 'jeton', 'integration', 'hmac'],
  'service-tokens': [
    'token',
    'jeton',
    'service',
    'machine',
    'ferme de rendu',
    'render farm',
    'bot',
    'daemon',
    'scope',
    'portee',
  ],
  shotgrid: ['shotgrid', 'sg', 'flow', 'autodesk', 'site', 'synchronisation', 'sync'],
  updates: [
    'mise a jour',
    'update',
    'upgrade',
    'sauvegarde',
    'backup',
    'restauration',
    'restore',
    'retour arriere',
    'rollback',
    'agent',
    'github',
    'changelog',
    'nouveautes',
  ],
  jobs: ['jobs', 'files', 'queue', 'ffmpeg', 'transcodage', 'worker', 'echecs', 'failed', 'purge'],
  trash: ['corbeille', 'trash', 'suppression', 'delete', 'restaurer', 'restore'],
  retention: ['retention', 'conservation', 'purge', 'journaux', 'logs', 'duree', 'duration', 'rgpd', 'gdpr'],
  'media-access': ['acces', 'access', 'medias', 'media', 'consultation', 'journal', 'log'],
  live: ['live', 'salle', 'room', 'direct', 'session', 'cadence', 'hz', 'synchronisation', 'sync'],
  chat: ['slack', 'discord', 'chat', 'messagerie', 'notification', 'webhook', 'equipe', 'team'],
};

/**
 * The settings each section renders, by their label key.
 *
 * Taken from the screens themselves: this is the list the search indexes in addition to
 * the keywords, and the only way "HMAC key", "audio bitrate" or "batch size"
 * lead anywhere. A section absent from here exposes no named setting (lists,
 * logs) and is found through its keywords.
 */
export const SECTION_SETTING_LABELS: Partial<Record<string, MessageKey[]>> = {
  settings: ['settings.studioName', 'settings.accentColour', 'reviewStatus.defaultLang', 'burnin.studioLogo'],
  identity: [
    'sso.oidcTitle',
    'sso.enable',
    'sso.issuer',
    'sso.clientId',
    'sso.clientSecret',
    'sso.appUrl',
    'sso.autoCreate',
    'sso.buttonLabel',
    'sso.logoTitle',
    'sso.passwordTitle',
    'sso.passwordDisable',
  ],
  'login-appearance': [
    'login.appearance.background',
    'login.appearance.blur',
    'login.appearance.fit',
    'login.appearance.layout',
    'login.appearance.overlay',
    'login.appearance.showLogo',
    'login.appearance.tagline',
  ],
  system: ['system.licenseTitle', 'system.thirdParty', 'system.resources', 'system.platform'],
  defaults: [
    'defaults.formatRate',
    'defaults.naming',
    'defaults.departments',
    'pipeline.width',
    'pipeline.height',
    'pipeline.fps',
    'pipeline.prefix.sequence',
    'pipeline.prefix.shot',
    'pipeline.step',
    'pipeline.digits',
    'settings.draftMode',
    'settings.taskPolicy',
    'reviewRequest.title',
    'burnin.title',
  ],
  storage: ['storage.totalUsage', 'storage.originals', 'storage.derived', 'storage.byLocation'],
  visibility: [
    'visibility.newRule',
    'visibility.form.entityType',
    'visibility.form.pattern',
    'visibility.form.matchType',
  ],
  hdri: ['hdri.library', 'hdri.add'],
  ocio: ['ocio.installed', 'ocio.setDefault', 'ocio.acesReleases'],
  video: [
    'transcode.renditions',
    'transcode.adaptiveHls',
    'transcode.singleProxy',
    'transcode.crf',
    'transcode.preset',
    'transcode.audioKbps',
    'transcode.maxPx',
    'transcode.sceneDetect',
  ],
  distribution: [
    'dist.watermarkTitle',
    'dist.accountName',
    'dist.linkNameDate',
    'review.opacity',
    'burnin.title',
    'burnin.slateShort',
    'burnin.timecode',
    'burnin.shotCode',
    'burnin.versionName',
    'burnin.freeText',
    'burnin.studioLogo',
  ],
  'review-statuses': ['reviewStatus.new', 'reviewStatus.approval', 'reviewStatus.retake', 'common.color'],
  smtp: [
    'common.host',
    'smtp.port',
    'common.user',
    'login.password',
    'smtp.from',
    'smtp.secure',
    'smtp.allowInsecure',
    'smtp.sendTest',
  ],
  api: ['webhooks.scope', 'webhooks.hmacSecret', 'webhooks.deliveries', 'tokens.studio'],
  'service-tokens': [
    'tokens.service.new',
    'tokens.allProjects',
    'tokens.expired',
    'tokens.read',
    'tokens.write',
  ],
  shotgrid: [
    'shotgrid.site.name',
    'shotgrid.site.baseUrl',
    'shotgrid.site.authMode',
    'shotgrid.site.scriptName',
    'shotgrid.site.scriptKey',
    'shotgrid.site.login',
    'shotgrid.site.password',
  ],
  updates: [
    'ops.latest.title',
    'ops.backups.title',
    'ops.backups.create',
    'ops.backups.check',
    'about.version',
  ],
  jobs: ['jobs.purgeDerived', 'jobs.purgeFailed', 'versions.keep', 'jobs.retry'],
  retention: ['retention.title', 'retention.batchTitle', 'retention.batchSize'],
  announcements: ['admin.announce.new', 'admin.announce.everyRole'],
  trash: ['settings.trashRetention', 'common.restore', 'common.deletePermanently'],
};

/**
 * Search index of a section: its label, its identifier, its keywords, and the
 * labels of the settings it renders.
 */
export function sectionHaystack(key: string, label: string, t: (k: MessageKey) => string): string {
  const parts: (string | undefined)[] = [label, key, ...(SECTION_KEYWORDS[key] ?? [])];
  // Key/value settings are indexed in the section that renders them: "simultaneous
  // uploads" leads to "Storage", "trash retention" to "Retention".
  if (isSettingsHome(key)) parts.push(...fieldsFor(key).map((f) => t(f.labelKey)));
  parts.push(...(SECTION_SETTING_LABELS[key] ?? []).map((labelKey) => t(labelKey)));
  return haystack(parts);
}

/** Does the section render key/value settings? */
const isSettingsHome = (key: string): key is SettingsHome =>
  (SETTINGS_HOMES as readonly string[]).includes(key);

/** Does the section match the search? An empty search lets everything through. */
export function sectionMatches(hay: string, query: string): boolean {
  return matchesQuery(hay, query);
}

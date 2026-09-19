// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { SETTINGS_HOMES, fieldsFor, type SettingsHome } from './studioSettings';
import type { MessageKey } from '../../i18n';

/**
 * Recherche dans les réglages.
 *
 * Vingt-huit sections réparties en cinq groupes, sans aucun moyen de chercher : pour
 * trouver le watermark il fallait savoir qu'il vit dans « Diffusion », et pour la rétention
 * des journaux qu'elle n'est pas au même endroit que celle de la corbeille. C'est
 * exactement ce qui rend les réglages de ShotGrid praticables : on y tape ce qu'on cherche.
 *
 * La recherche porte sur les **libellés de champs**, pas seulement sur les noms de
 * sections : personne ne cherche « Diffusion », on cherche « watermark ». D'où l'index
 * ci-dessous, qui rattache à chaque section les mots qu'on emploie réellement pour la
 * désigner.
 */

/** Casse et accents ignorés — « reglages » doit trouver « Réglages ». */
export function fold(value: string): string {
  return value
    .toLocaleLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}

/**
 * Mots-clés supplémentaires par section, en plus de son libellé traduit.
 *
 * Volontairement en anglais **et** en français : un studio francophone cherche « filigrane »
 * autant que « watermark », et les termes de production restent en anglais partout.
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
  smtp: ['smtp', 'email', 'mail', 'courriel', 'expediteur', 'sender'],
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
  jobs: ['jobs', 'files', 'queue', 'ffmpeg', 'transcodage', 'worker', 'echecs', 'failed'],
  trash: ['corbeille', 'trash', 'suppression', 'delete', 'restaurer', 'restore'],
  retention: ['retention', 'conservation', 'purge', 'journaux', 'logs', 'duree', 'duration'],
  'media-access': ['acces', 'access', 'medias', 'media', 'consultation', 'journal', 'log'],
  live: ['live', 'salle', 'room', 'direct', 'session', 'cadence', 'hz', 'synchronisation', 'sync'],
  chat: ['slack', 'discord', 'chat', 'messagerie', 'notification', 'webhook', 'equipe', 'team'],
};

/**
 * Index de recherche d'une section : son libellé, son identifiant, ses mots-clés, et les
 * libellés des réglages qu'elle contient quand on les connaît.
 */
export function sectionHaystack(key: string, label: string, t: (k: MessageKey) => string): string {
  const parts = [label, key, ...(SECTION_KEYWORDS[key] ?? [])];
  // Les réglages clé/valeur sont indexés dans la section qui les rend : « uploads
  // simultanés » mène à « Stockage », « rétention corbeille » à « Rétention ». Tant qu'ils
  // vivaient tous au même endroit, la recherche renvoyait toujours le même écran.
  if (isSettingsHome(key)) parts.push(...fieldsFor(key).map((f) => t(f.labelKey)));
  return fold(parts.join(' '));
}

/** La section rend-elle des réglages clé/valeur ? */
const isSettingsHome = (key: string): key is SettingsHome =>
  (SETTINGS_HOMES as readonly string[]).includes(key);

/** La section répond-elle à la recherche ? Une recherche vide laisse tout passer. */
export function sectionMatches(haystack: string, query: string): boolean {
  const needle = fold(query.trim());
  if (!needle) return true;
  // Tous les mots doivent être présents : « quota stockage » ne doit pas rendre la moitié
  // de l'administration.
  return needle.split(/\s+/).every((word) => haystack.includes(word));
}

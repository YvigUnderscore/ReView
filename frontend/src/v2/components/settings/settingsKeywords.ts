// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The words one searches a project or profile setting by.
 *
 * A card's title is never enough: nobody searches for "Burn-ins", one searches for "watermark"; nobody searches for
 * "Display", one searches for "dark". These lists are not displayed, so they need not go through `t()`, and they are
 * deliberately bilingual, like the index of administration sections: a French-speaking studio searches for "cadence" as
 * much as for "fps", and the production vocabulary stays in English.
 */
export const SETTINGS_KEYWORDS = {
  // Project settings
  inheritance: ['heritage', 'inheritance', 'studio', 'defaut', 'default', 'override', 'surcharge'],
  startFrame: ['frame', 'start', 'depart', 'timecode', 'premiere image', 'first frame'],
  format: ['resolution', 'format', 'fps', 'cadence', 'framerate', 'largeur', 'hauteur', 'width', 'height'],
  nomenclature: ['nomenclature', 'prefixe', 'prefix', 'numerotation', 'padding', 'chiffres', 'digits'],
  episodes: ['episode', 'serie', 'series', 'saison', 'season'],
  departments: ['departement', 'department', 'step', 'pipe', 'pipeline', 'etape', 'discipline'],
  naming: ['nommage', 'naming', 'regex', 'motif', 'pattern', 'fichier', 'filename', 'upload'],
  reviewRequest: ['review', 'consigne', 'brief', 'note', 'reviewer', 'tag'],
  lighting: ['hdri', 'eclairage', 'lighting', '3d', 'environnement', 'environment'],
  color: ['ocio', 'couleur', 'color', 'aces', 'display', 'view', 'lut', 'colorspace'],
  storage: ['stockage', 'storage', 'quota', 'espace', 'bucket', 'minio', 'octets', 'bytes'],
  burnin: ['burn-in', 'burnin', 'watermark', 'filigrane', 'slate', 'incrustation', 'timecode'],
  shotgrid: ['shotgrid', 'sg', 'flow', 'autodesk', 'synchronisation', 'sync', 'lien', 'link'],

  // Profile settings
  avatar: ['avatar', 'photo', 'portrait', 'image', 'initiales', 'initials'],
  identity: ['nom', 'name', 'prenom', 'email', 'courriel', 'telephone', 'phone', 'poste', 'job', 'bio'],
  password: ['mot de passe', 'password', 'motdepasse', 'securite', 'security', 'changer', 'change'],
  display: [
    'theme',
    'sombre',
    'dark',
    'clair',
    'light',
    'densite',
    'density',
    'langue',
    'language',
    'vue',
    'view',
  ],
  notifications: [
    'notification',
    'email',
    'digest',
    'push',
    'rapport',
    'report',
    'cloche',
    'bell',
    'mention',
  ],
  twofa: ['2fa', 'totp', 'double facteur', 'two factor', 'authenticator', 'securite', 'security', 'code'],
  sessions: ['session', 'appareil', 'device', 'connexion', 'login', 'revoquer', 'revoke'],
  tokens: ['token', 'jeton', 'api', 'cle', 'key', 'scope', 'portee', 'integration'],
} as const satisfies Record<string, readonly string[]>;

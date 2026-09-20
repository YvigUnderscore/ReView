// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Les mots par lesquels on vient chercher un réglage de projet ou de profil.
 *
 * Le titre d'une carte ne suffit jamais : personne ne cherche « Burn-ins », on cherche
 * « filigrane » ; personne ne cherche « Affichage », on cherche « sombre ». Ces listes ne
 * s'affichent pas — elles n'ont donc pas à passer par `t()` — et sont volontairement
 * bilingues, comme l'index des sections d'administration : un studio francophone cherche
 * « cadence » autant que « fps », et le vocabulaire de production reste en anglais.
 */
export const SETTINGS_KEYWORDS = {
  // Réglages d'un projet
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

  // Réglages d'un profil
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

import { join, normalize, resolve, sep } from 'node:path';

/**
 * Extraction d'archive bornée et sans traversée (Phase 45, 45.A). Logique **pure et testable** :
 * on décide à partir du **catalogue** de l'archive (noms + tailles annoncées) si l'extraction est
 * acceptable, AVANT d'écrire le moindre octet sur le disque du worker.
 *
 * Trois familles d'attaque sont couvertes :
 *  - **zip-slip** : une entrée nommée `../../etc/cron.d/x` s'écrit hors du répertoire cible ;
 *  - **liens symboliques** : une entrée symlink pointant vers `/` transforme l'extraction suivante
 *    en écriture arbitraire (adm-zip ne matérialise pas les symlinks, mais on refuse par principe) ;
 *  - **bombe de décompression** : quelques Ko compressés qui pèsent des To une fois extraits.
 *
 * Décision **tout ou rien** : une seule entrée suspecte invalide l'archive entière. Extraire
 * partiellement une scène USD produirait un modèle silencieusement incomplet — pire qu'une erreur.
 */

/** Entrée d'archive telle que décrite par le catalogue central du zip. */
export interface ZipEntryInfo {
  /** Chemin déclaré dans l'archive (séparateurs `/` ou `\`, non nettoyé). */
  name: string;
  /** Taille décompressée annoncée. */
  size: number;
  /** Taille compressée annoncée. */
  compressedSize: number;
  /** Entrée « répertoire » (pas de contenu à écrire). */
  isDirectory: boolean;
  /** Attributs externes du zip : le mode Unix occupe les 16 bits hauts (détection des symlinks). */
  externalAttributes?: number;
}

/** Bornes d'extraction (configurables — cf. `config/env.ts`). */
export interface ZipLimits {
  /** Nombre maximal d'entrées (une scène USD volumineuse reste sous quelques milliers). */
  maxEntries: number;
  /** Taille décompressée cumulée maximale, en octets. */
  maxTotalBytes: number;
  /** Ratio de compression global maximal toléré (décompressé / compressé). */
  maxRatio: number;
}

/** Motif de refus d'une archive — remonté tel quel à l'utilisateur (message court, sans chemin absolu). */
export type ZipRejection =
  | { code: 'ABSOLUTE_PATH'; entry: string }
  | { code: 'PATH_TRAVERSAL'; entry: string }
  | { code: 'SYMLINK'; entry: string }
  | { code: 'TOO_MANY_ENTRIES'; limit: number; actual: number }
  | { code: 'TOO_LARGE'; limit: number; actual: number }
  | { code: 'RATIO'; limit: number; actual: number };

/** Résultat de la planification : soit les fichiers à extraire, soit un refus motivé. */
export interface ExtractionPlan {
  /** Entrées « fichier » retenues (les répertoires sont recréés implicitement). */
  files: ZipEntryInfo[];
  /** Somme des tailles décompressées annoncées. */
  totalBytes: number;
  /** Non nul = archive refusée, `files` est alors vide. */
  rejection: ZipRejection | null;
}

/**
 * En dessous de ce volume décompressé, le contrôle de ratio est ignoré : un petit fichier très
 * répétitif (un `.usda` ASCII, par exemple) compresse légitimement à 1:1000 sans être une bombe.
 */
const RATIO_FLOOR_BYTES = 8 * 1024 * 1024;

/** Masque du type de fichier dans un mode Unix, et valeur correspondant à un lien symbolique. */
const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;

/** Vrai si les attributs externes du zip décrivent un lien symbolique Unix. */
export function isSymlinkEntry(externalAttributes: number | undefined): boolean {
  if (typeof externalAttributes !== 'number' || externalAttributes === 0) return false;
  // Les 16 bits hauts portent le mode Unix quand l'archive a été créée sous Unix.
  const mode = (externalAttributes >>> 16) & 0xffff;
  return (mode & S_IFMT) === S_IFLNK;
}

/**
 * Normalise un nom d'entrée en chemin POSIX relatif, ou renvoie le motif de refus.
 * Refuse les chemins absolus (`/x`, `C:\x`, UNC), les segments `..` et les octets nuls.
 */
export function normalizeEntryName(name: string): { path: string } | { reject: ZipRejection } {
  if (name.includes('\0')) return { reject: { code: 'PATH_TRAVERSAL', entry: name } };
  const unified = name.replace(/\\/g, '/');
  if (unified.startsWith('/') || /^[A-Za-z]:\//.test(unified) || unified.startsWith('//'))
    return { reject: { code: 'ABSOLUTE_PATH', entry: name } };
  const segments = unified.split('/').filter((s) => s !== '' && s !== '.');
  if (segments.some((s) => s === '..')) return { reject: { code: 'PATH_TRAVERSAL', entry: name } };
  return { path: segments.join('/') };
}

/**
 * Décide de l'extraction d'une archive à partir de son catalogue. Renvoie les entrées fichier
 * retenues (nom normalisé en chemin POSIX relatif) ou un refus motivé — jamais les deux.
 */
export function planExtraction(entries: ZipEntryInfo[], limits: ZipLimits): ExtractionPlan {
  const reject = (rejection: ZipRejection): ExtractionPlan => ({ files: [], totalBytes: 0, rejection });

  if (entries.length > limits.maxEntries)
    return reject({ code: 'TOO_MANY_ENTRIES', limit: limits.maxEntries, actual: entries.length });

  const files: ZipEntryInfo[] = [];
  let totalBytes = 0;
  let compressedBytes = 0;

  for (const entry of entries) {
    const normalized = normalizeEntryName(entry.name);
    if ('reject' in normalized) return reject(normalized.reject);
    // Le contrôle des symlinks passe après la normalisation : un symlink nommé `../x` doit être
    // signalé comme traversée (motif le plus explicite pour l'utilisateur).
    if (isSymlinkEntry(entry.externalAttributes)) return reject({ code: 'SYMLINK', entry: entry.name });
    if (entry.isDirectory) continue;

    totalBytes += Math.max(0, entry.size);
    compressedBytes += Math.max(0, entry.compressedSize);
    if (totalBytes > limits.maxTotalBytes)
      return reject({ code: 'TOO_LARGE', limit: limits.maxTotalBytes, actual: totalBytes });

    files.push({ ...entry, name: normalized.path });
  }

  if (totalBytes > RATIO_FLOOR_BYTES && compressedBytes > 0) {
    const ratio = totalBytes / compressedBytes;
    if (ratio > limits.maxRatio)
      return reject({ code: 'RATIO', limit: limits.maxRatio, actual: Math.round(ratio) });
  }

  return { files, totalBytes, rejection: null };
}

/** Message court et lisible (français, UI) pour un refus d'archive. */
export function describeRejection(rejection: ZipRejection): string {
  switch (rejection.code) {
    case 'ABSOLUTE_PATH':
      return `Archive refusée : chemin absolu interdit (${rejection.entry})`;
    case 'PATH_TRAVERSAL':
      return `Archive refusée : chemin sortant de l'archive (${rejection.entry})`;
    case 'SYMLINK':
      return `Archive refusée : lien symbolique interdit (${rejection.entry})`;
    case 'TOO_MANY_ENTRIES':
      return `Archive refusée : ${rejection.actual} entrées (maximum ${rejection.limit})`;
    case 'TOO_LARGE':
      return `Archive refusée : contenu décompressé supérieur à ${Math.round(rejection.limit / 1024 / 1024)} Mo`;
    case 'RATIO':
      return `Archive refusée : taux de compression anormal (×${rejection.actual}, maximum ×${rejection.limit})`;
  }
}

/**
 * Chemin de destination d'une entrée, garanti **à l'intérieur** de `destDir`. Renvoie `null` si la
 * résolution s'en échappe — double sécurité au moment de l'écriture, après `planExtraction`.
 */
export function resolveInside(destDir: string, entryName: string): string | null {
  const normalized = normalizeEntryName(entryName);
  if ('reject' in normalized) return null;
  const base = resolve(destDir);
  const target = resolve(join(base, normalize(normalized.path)));
  if (target !== base && !target.startsWith(base + sep)) return null;
  return target;
}

/**
 * Passerelle CSV shots/tâches (38.F/38.G) — format tableur simple, compatible export→import
 * (chemin retour ShotGrid/Ftrack/Kitsu via colonnes homogènes). Parsing PUR (testé), aucune
 * dépendance Prisma : le service applique le résultat.
 *
 * Colonnes (en-tête obligatoire, ordre libre, casse ignorée) :
 *   sequence : code de séquence (optionnel — vide = shot hors séquence)
 *   shot     : code du shot (obligatoire)
 *   name     : nom du shot (optionnel — défaut = code)
 *   tasks    : noms de tâches séparés par « | » (optionnel)
 */

export interface ParsedShotRow {
  sequence: string | null;
  shot: string;
  name: string;
  tasks: string[];
}

export interface ParseResult {
  rows: ParsedShotRow[];
  errors: string[];
}

/** Découpe une ligne CSV en champs (gère les guillemets et le séparateur `,` ou `;`). */
function splitCsvLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQuotes = false;
      } else cur += c;
    } else if (c === '"') inQuotes = true;
    else if (c === delimiter) {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out.map((f) => f.trim());
}

/** Détecte le délimiteur dominant de l'en-tête (`;` sinon `,`). */
function detectDelimiter(header: string): string {
  return header.includes(';') && !header.includes(',') ? ';' : ',';
}

/** Parse un CSV de shots/tâches. Renvoie les lignes valides + la liste des erreurs. */
export function parseShotsCsv(text: string): ParseResult {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const headerLine = lines[0];
  if (!headerLine) return { rows: [], errors: ['Fichier vide'] };

  const delimiter = detectDelimiter(headerLine);
  const header = splitCsvLine(headerLine, delimiter).map((h) => h.toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const iShot = col('shot');
  if (iShot === -1) return { rows: [], errors: ['Colonne « shot » manquante dans l’en-tête'] };
  const iSeq = col('sequence');
  const iName = col('name');
  const iTasks = col('tasks');

  const rows: ParsedShotRow[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  for (let n = 1; n < lines.length; n++) {
    const f = splitCsvLine(lines[n] ?? '', delimiter);
    const shot = (f[iShot] ?? '').trim();
    if (!shot) {
      errors.push(`Ligne ${n + 1} : code de shot manquant`);
      continue;
    }
    const sequence = iSeq >= 0 && f[iSeq] ? f[iSeq].trim() : null;
    const key = `${sequence ?? ''}::${shot}`;
    if (seen.has(key)) {
      errors.push(`Ligne ${n + 1} : shot en double (${shot})`);
      continue;
    }
    seen.add(key);
    const tasks =
      iTasks >= 0 && f[iTasks]
        ? f[iTasks]
            .split('|')
            .map((t) => t.trim())
            .filter(Boolean)
        : [];
    rows.push({ sequence, shot, name: (iName >= 0 && f[iName]?.trim()) || shot, tasks });
  }
  return { rows, errors };
}

/**
 * Échappe un champ CSV (guillemets si séparateur/quote/retour présent) et neutralise
 * l'injection de formule tableur : un champ commençant par `= + - @` (ou tab/CR) est préfixé
 * d'une apostrophe pour qu'Excel/Sheets ne l'interprète pas comme une formule.
 */
function csvField(v: string): string {
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export interface ExportShotRow {
  sequence: string | null;
  shot: string;
  name: string;
  tasks: string[];
}

/** Sérialise des shots/tâches au format CSV (en-tête inclus), ré-importable tel quel. */
export function toShotsCsv(rows: ExportShotRow[]): string {
  const lines = ['sequence,shot,name,tasks'];
  for (const r of rows) {
    lines.push(
      [csvField(r.sequence ?? ''), csvField(r.shot), csvField(r.name), csvField(r.tasks.join('|'))].join(','),
    );
  }
  return lines.join('\n');
}

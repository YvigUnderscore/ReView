// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Contrôle du dossier `DOCUMENTATION/` — la documentation est du livrable, pas un brouillon.
 *
 * Soixante-dix pages qui se citent les unes les autres, une centaine de figures : à la main,
 * un lien mort ne se découvre qu'en cliquant dessus, et une figure supprimée laisse un carré
 * blanc que personne ne signale. Cinq contrôles, tous mécaniques :
 *
 *   1. **Préambule** — `# Titre`, sous-titre en italique, `> Updated: AAAA-MM-JJ`. C'est ce
 *      que la page /docs affiche en en-tête et ce que le manifest indexe pour la recherche ;
 *      une page sans préambule s'affiche sans sous-titre ni date.
 *   2. **Liens internes** — tout `[x](autre-page.md)` désigne un fichier existant, et toute
 *      ancre `#chapitre` un titre réellement présent dans la page visée.
 *   3. **Images** — tout `![x](../assets/…)` désigne un fichier existant, et porte un texte
 *      alternatif (il devient la légende dans l'application).
 *   4. **Figures SVG** — bien formées, dimensionnées par `viewBox`, titrées (lecteur
 *      d'écran), et adaptées au thème sombre. Une figure lisible en clair seulement est
 *      illisible pour la moitié des lecteurs, le mode sombre étant le défaut de ReView.
 *   5. **Orphelines** — une figure que plus aucune page ne cite est du poids mort.
 *
 * Usage : node scripts/check-docs.mjs [--list]
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = 'DOCUMENTATION';

/** Pages dispensées de préambule : elles ne sont pas servies par la page /docs. */
const NO_PREAMBLE = new Set(['CHANGELOG.md']);

/**
 * Ancre d'un titre — même forme que `frontend/src/v2/pages/docs/docsRender.ts`. Les deux
 * implémentations doivent rester d'accord : ce contrôle valide les ancres que l'application
 * pose, et un lien accepté ici doit y fonctionner.
 */
export function slugifyHeading(text) {
  const slug = text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N} _-]/gu, '')
    .replace(/ /g, '-');
  return slug || 'section';
}

/** Titres d'une page, ancres comprises, doublons numérotés comme dans l'application. */
export function headingAnchors(markdown) {
  const seen = new Map();
  const anchors = [];
  let inFence = false;
  for (const line of markdown.split('\n')) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    if (inFence) continue;
    const heading = line.match(/^(#{1,4})\s+(.+?)\s*$/);
    if (!heading) continue;
    // Le markdown en ligne ne fait pas partie du texte du titre une fois rendu.
    const text = heading[2]
      .replace(/`([^`]*)`/g, '$1')
      .replace(/\*\*([^*]*)\*\*/g, '$1')
      .replace(/\*([^*]*)\*/g, '$1')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
    const base = slugifyHeading(text);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    anchors.push(n === 0 ? base : `${base}-${n}`);
  }
  return anchors;
}

/** Le préambule conventionnel est-il complet ? Rend la liste de ce qui manque. */
export function missingPreamble(markdown) {
  const lines = markdown.split('\n').slice(0, 8);
  const missing = [];
  if (!lines[0]?.startsWith('# ')) missing.push('titre de niveau 1 en première ligne');
  if (!lines.some((l) => /^\*[^*].*\*\s*$/.test(l.trim()))) missing.push('sous-titre en italique (*…*)');
  if (!lines.some((l) => /^>\s*Updated\s*:\s*\d{4}-\d{2}-\d{2}/.test(l)))
    missing.push('ligne « > Updated: AAAA-MM-JJ »');
  return missing;
}

/** Liens et images d'une page, hors blocs de code (un exemple n'est pas un lien). */
export function references(markdown) {
  const body = markdown.replace(/```[\s\S]*?```/g, '');
  const links = [...body.matchAll(/(!?)\[([^\]]*)\]\(([^)\s]+)\)/g)];
  return links.map(([, bang, text, target]) => ({ image: bang === '!', text, target }));
}

/**
 * Conventions d'une figure SVG. Contrôle textuel : un analyseur XML complet serait une
 * dépendance de plus pour une garantie que ces quatre motifs donnent déjà.
 */
export function figureProblems(svg) {
  const problems = [];
  if (!/<svg[\s>]/.test(svg) || !/<\/svg>\s*$/.test(svg))
    problems.push('ne commence pas par <svg> ou ne finit pas par </svg>');
  if (!/viewBox="[\d\s.-]+"/.test(svg)) problems.push('sans viewBox (la figure ne se redimensionne pas)');
  if (!/<title[\s>]/.test(svg)) problems.push('sans <title> (illisible au lecteur d’écran)');
  if (!/role="img"/.test(svg)) problems.push('sans role="img"');
  if (!/prefers-color-scheme:\s*dark/.test(svg))
    problems.push('sans variante sombre (@media prefers-color-scheme)');

  // Équilibre des balises : la faute la plus fréquente d'une figure écrite à la main.
  const opened = [...svg.matchAll(/<([a-zA-Z][\w:-]*)(\s[^>]*?)?(\/?)>/g)].filter((m) => m[3] !== '/');
  const closed = [...svg.matchAll(/<\/([a-zA-Z][\w:-]*)>/g)];
  const voids = new Set([
    'path',
    'rect',
    'circle',
    'line',
    'polyline',
    'polygon',
    'ellipse',
    'use',
    'stop',
    'image',
  ]);
  const stack = [];
  for (const m of opened) if (!voids.has(m[1])) stack.push(m[1]);
  for (const m of closed) {
    const i = stack.lastIndexOf(m[1]);
    if (i === -1) problems.push(`</${m[1]}> sans ouverture`);
    else stack.splice(i, 1);
  }
  if (stack.length > 0) problems.push(`balise(s) non fermée(s) : ${[...new Set(stack)].join(', ')}`);
  return problems;
}

/** Tous les fichiers d'une extension sous un dossier, chemins relatifs à `DOCUMENTATION/`. */
function* files(dir, ext) {
  for (const entry of readdirSync(path.join(repoRoot, ROOT, dir), { withFileTypes: true })) {
    const rel = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) yield* files(rel, ext);
    else if (entry.name.endsWith(ext)) yield rel;
  }
}

const exists = (rel) => {
  try {
    return statSync(path.join(repoRoot, ROOT, rel)).isFile();
  } catch {
    return false;
  }
};

/** Résout un chemin relatif depuis une page ("a/b.md" + "../c.svg" → "c.svg"). */
const resolveFrom = (page, target) => path.posix.normalize(path.posix.join(path.posix.dirname(page), target));

function main() {
  const list = process.argv.includes('--list');
  const problems = [];
  const pages = [...files('', '.md')];
  const figures = new Set([...files('assets', '.svg')]);
  const used = new Set();
  const anchorsOf = new Map(
    pages.map((p) => [p, headingAnchors(readFileSync(path.join(repoRoot, ROOT, p), 'utf8'))]),
  );

  for (const page of pages) {
    const markdown = readFileSync(path.join(repoRoot, ROOT, page), 'utf8');
    const add = (message) => problems.push(`${ROOT}/${page}: ${message}`);

    if (!NO_PREAMBLE.has(page))
      for (const missing of missingPreamble(markdown)) add(`préambule incomplet — ${missing}`);

    for (const ref of references(markdown)) {
      if (/^([a-z]+:|\/\/)/i.test(ref.target)) continue; // lien externe
      const [target, anchor] = ref.target.split('#');

      if (ref.image) {
        if (!ref.text.trim()) add(`image sans texte alternatif : ${ref.target}`);
        const resolved = resolveFrom(page, target);
        if (!exists(resolved)) add(`image introuvable : ${ref.target}`);
        used.add(resolved);
        continue;
      }

      if (!target) {
        if (anchor && !anchorsOf.get(page)?.includes(anchor))
          add(`ancre introuvable dans la page : #${anchor}`);
        continue;
      }
      if (!target.endsWith('.md')) continue; // fichier joint (CSV d'exemple…)
      const resolved = resolveFrom(page, target);
      if (!exists(resolved)) {
        add(`lien mort : ${ref.target}`);
        continue;
      }
      if (anchor && !anchorsOf.get(resolved)?.includes(anchor)) add(`ancre introuvable : ${ref.target}`);
    }
  }

  for (const figure of figures) {
    const svg = readFileSync(path.join(repoRoot, ROOT, figure), 'utf8');
    for (const problem of figureProblems(svg)) problems.push(`${ROOT}/${figure}: ${problem}`);
    if (!used.has(figure)) problems.push(`${ROOT}/${figure}: figure orpheline — aucune page ne la cite`);
  }

  if (problems.length === 0) {
    console.log(
      `\x1b[0;32m✓ Documentation : ${pages.length} page(s), ${figures.size} figure(s) — préambules, liens, images et figures conformes\x1b[0m`,
    );
    return;
  }

  console.error(`\x1b[0;31m✗ Documentation : ${problems.length} problème(s)\x1b[0m`);
  for (const problem of list ? problems : problems.slice(0, 40)) console.error(`  ${problem}`);
  if (!list && problems.length > 40)
    console.error(`  … et ${problems.length - 40} autre(s) — relancer avec --list`);
  process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Détecte le texte d'interface écrit en dur dans le frontend — c'est-à-dire tout ce qui
 * s'affiche sans passer par `t()`.
 *
 * Deux générations de ce contrôle ont échoué avant celle-ci, chacune parce qu'elle cherchait
 * la mauvaise chose :
 *   1. la première ne lisait que du texte JSX tenant sur une ligne — tout ce que Prettier
 *      coupait lui échappait ;
 *   2. la seconde cherchait des *marqueurs de français* (accents, mots-outils). Or « Port »,
 *      « Cadence », « Objets », « Commentaires », « Note », « Import CSV » n'en portent aucun :
 *      l'interface est restée à moitié française en chinois avec un contrôle au vert.
 *
 * D'où le critère retenu ici, qui ne dépend d'aucune langue : **tout littéral qui atteint
 * l'écran est une faute**, quelle que soit la langue dans laquelle il est écrit. On analyse
 * l'AST TypeScript plutôt que des expressions régulières, et on relève :
 *   - le texte JSX (`<p>Bonjour</p>`) ;
 *   - les props qui s'affichent ou sont lues à voix haute (`title`, `placeholder`,
 *     `aria-label`, `label`, `alt`…) ;
 *   - les littéraux passés aux fonctions qui parlent à l'utilisateur (`toast.*`, `confirm`) ;
 *   - les gabarits `` `${n} fichier(s) supprimé(s)` ``, où qu'ils soient : une phrase autour
 *     d'une interpolation est du texte d'interface, et c'est la forme qui échappait le plus
 *     souvent aux contrôles précédents.
 *
 * Ce qui n'est pas du texte d'interface (identifiants, classes CSS, unités, sigles, noms
 * propres) est écarté par `ALLOWED` et `SKIP` — explicitement, pas par devinette.
 *
 * Le total est comparé à un plafond (`CEILING`) : la suite échoue s'il remonte. Baisser le
 * plafond quand on descend, jamais l'inverse.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { join, relative, resolve, sep } from 'node:path';

// TypeScript n'est pas installé à la racine : on emprunte celui du frontend, qui sert déjà
// au typecheck. Aucune dépendance nouvelle, donc aucune obligation de licence nouvelle.
const ts = createRequire(resolve('frontend/package.json'))('typescript');

const ROOT = 'frontend/src';

/** Reliquat de texte en dur toléré — dette à résorber, jamais à relever. */
const CEILING = 0;

/**
 * Balises dont le contenu est du littéral technique et non de la prose : une commande, un
 * en-tête HTTP, un préfixe de bucket, une touche. Y placer le texte est la façon *correcte*
 * de dire « ceci ne se traduit pas » — le contrôle s'y fie plutôt que de deviner.
 */
const CODE_TAGS = new Set(['code', 'pre', 'kbd', 'samp']);

/** Props dont la valeur atteint l'utilisateur (à l'écran ou via un lecteur d'écran). */
const VISIBLE_PROPS = new Set([
  'alt',
  'aria-label',
  'aria-placeholder',
  'aria-roledescription',
  'aria-valuetext',
  'cancelLabel',
  'confirmLabel',
  'description',
  'emptyLabel',
  'errorLabel',
  'heading',
  'help',
  'hint',
  'label',
  'message',
  'placeholder',
  'subtitle',
  'title',
  'tooltip',
]);

/** Fonctions qui affichent leur argument tel quel. */
const SPEAKING_CALLS = /^(toast(\.\w+)?|confirm|alert|prompt|window\.(confirm|alert|prompt))$/;

/** Props dont la valeur est une adresse, une classe ou un identifiant — jamais de la prose. */
const TECHNICAL_PROPS =
  /^(className|class|style|id|key|href|src|srcSet|to|type|name|value|htmlFor|accept|pattern|role|d|points|viewBox|data-.*|aria-(hidden|controls|labelledby|describedby))$/;

/** Appels dont les arguments sont des URL, des clés de cache ou des traces. */
const TECHNICAL_CALLS =
  /^(api\.\w+|fetch|navigate|qk(\.\w+)?|URL|URLSearchParams|encodeURI\w*|decodeURI\w*|console\.\w+|(local|session)Storage\.\w+|require|import)$/;

/**
 * Textes qui atteignent l'écran mais ne se traduisent pas : unités, sigles, noms propres,
 * vocabulaire de production (cf. `scripts/i18n-glossary.json`). Toute entrée ajoutée ici
 * doit être un mot qu'aucune langue ne rendrait autrement.
 */
const ALLOWED = new Set(
  [
    'ReView',
    'Bearer',
    'GOCSPX',
    'MinIO',
    'FFmpeg',
    'Three.js',
    'Excalidraw',
    'Blender',
    'OpenColorIO',
    'AGPL-3.0-or-later',
    // sigles et formats
    'ID',
    'URL',
    'API',
    'CSV',
    'JSON',
    'PDF',
    'HLS',
    'GLB',
    'USD',
    'OCIO',
    'HDRI',
    'SMTP',
    'SSO',
    'LDAP',
    'OIDC',
    'SAML',
    '2FA',
    'TOTP',
    'JWT',
    'RGB',
    'HSV',
    'LUT',
    'EXR',
    'SPZ',
    'SOG',
    'PLY',
    'MP4',
    'WEBM',
    'SRGB',
    'ACES',
    'NVENC',
    'CPU',
    'GPU',
    'RAM',
    'S3',
    'TLS',
    'IP',
    'UI',
    'FPS',
    'LOD',
    'DoF',
    'A/B',
    'PiP',
    'QR',
    // unités
    'px',
    'fps',
    'ms',
    's',
    'Ko',
    'Mo',
    'Go',
    'To',
    'KB',
    'MB',
    'GB',
    'TB',
    'kB',
    '%',
    '°',
    'mm',
    'm',
    'p',
    'kbps',
    'o',
    'x',
    'y',
    'z',
    '×',
    // touches et symboles d'interface
    'Ctrl',
    'Alt',
    'Shift',
    'Cmd',
    'Esc',
    'Tab',
    'Enter',
    'Space',
    '⌘',
    '⇧',
    '↑',
    '↓',
    '←',
    '→',
    'Ctrl+K',
    'Ctrl+V',
    // vocabulaire de production jamais traduit
    'shot',
    'shots',
    'sequence',
    'sequences',
    'asset',
    'assets',
    'dailies',
    'playblast',
    'version',
    'versions',
    'kanban',
    'board',
    'boards',
    'splat',
    'splats',
    'proxy',
    'slate',
    'burn-in',
    'timecode',
    'retake',
    'review',
    'reviews',
    'playlist',
    'playlists',
    'wipe',
  ].map((s) => s.toLowerCase()),
);

/**
 * Ce qui ressemble à du texte sans en être : identifiants, chemins, classes, gabarits CSS.
 * Ces valeurs vivent dans des props visibles (un `label` calculé, un `title` d'icône) ou
 * dans du JSX purement structurel.
 */
const SKIP = [
  /^[\p{P}\p{S}\p{N}\s]*$/u, // aucune lettre : ponctuation, chiffres, symboles
  /^(https?:|mailto:|data:|blob:|\/|\.{1,2}\/|#)/, // URL, chemin, ancre
  /^[a-z0-9]+([-_:][a-z0-9]+)+$/i, // kebab / snake / namespacé : classes, clés, événements
  /^[a-z][a-zA-Z0-9]*$/, // camelCase ou mot seul en minuscules : identifiant
  /^[A-Z0-9_]+$/, // SCREAMING_SNAKE
  /^\w+\.\w+/, // dot.case : clé de traduction, chemin de propriété
  /^\d/, // commence par un chiffre : format, dimension
  /(sans-serif|serif|monospace|var\(--|rgba?\(|#[0-9a-f]{3,8}\b)/i, // CSS
  /^[\w.+-]+@[\w-]+\.[a-z]{2,}$/i, // adresse e-mail d'exemple
  /^[\w-]+\/$/, // préfixe de bucket (`derived/`)
  /[\\^$]|\\[dwsn]|\{\d+,?\d*\}/, // expression régulière donnée en exemple
  /^[?&#]|^\w+=$|[?&]\w+=/, // fragment de query string (`?frame=`, `&live=1`)
  /^[\w-]*\.[a-z0-9]{2,4}$/i, // suffixe de nom de fichier (`-frame.jpg`)
  /^[\w-]+[-_=]$/, // préfixe d'identifiant (`seq-`, `project-`)
  /^\.\w/, // accès de propriété (shaders, dyno Spark)
  /^[\w:-]+[:.]$/, // préfixe de canal ou de clé (`task:`, `review:tree:`, `onboarding.`)
  /<\/?[a-z][\w-]*[\s/>]/i, // balise HTML ou SVG assemblée à la main
  /[;{}]|^[-+*/%<>=!&|]\s|^\)|\w\($/, // code : instruction, opérateur de tête, appel
  /\b(float|vec[234]|int|uint|mat[234]|gl_\w+)\b/, // GLSL
  /\b(translate|scale|rotate|matrix|calc|url)\(/i, // fonction CSS
];

/** Une pile de classes utilitaires : tout en minuscules, avec au moins un `-`/`[` interne. */
export const isUtilityClasses = (text) => {
  const words = text.split(' ');
  return (
    words.length > 1 &&
    words.every((w) => /^[a-z0-9:./[\]%#!-]+$/.test(w)) &&
    words.some((w) => /[-[]/.test(w))
  );
};

export const isIdentifierLike = (text) => SKIP.some((re) => re.test(text)) || isUtilityClasses(text);

/** Même filtre, sans les deux règles qui confondraient un mot ordinaire avec un identifiant. */
const IDENTIFIER_ONLY = [/^[a-z0-9]+([-_:][a-z0-9]+)+$/i, /^[a-z][a-zA-Z0-9]*$/];
const PROSE_SKIP = SKIP.filter((re) => !IDENTIFIER_ONLY.some((id) => id.source === re.source));

export function isAllowed(text) {
  const clean = text.replace(/[\p{P}\p{S}\p{N}]/gu, ' ').trim();
  if (!clean) return true;
  return clean.split(/\s+/).every((word) => ALLOWED.has(word.toLowerCase()));
}

/** Un littéral de chaîne ou un gabarit sans interpolation ; sinon `null`. */
export function literalOf(node) {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isJsxExpression(node)) return literalOf(node.expression);
  // `cond ? 'Oui' : 'Non'` — les deux branches comptent, on les rend en une fois.
  if (ts.isConditionalExpression(node)) {
    const parts = [literalOf(node.whenTrue), literalOf(node.whenFalse)].filter(Boolean);
    return parts.length ? parts.join(' / ') : null;
  }
  return null;
}

/** `??` et `||` : les deux façons d'écrire une valeur de repli. */
const FALLBACK_OPERATORS = new Set([ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken]);

/**
 * Le nœud aboutit-il à l'écran ? Vrai s'il est rendu par du JSX, passé à une prop de
 * libellé ou à un appel parlant (`toast`, `confirm`…). C'est ce qui distingue une valeur
 * de repli affichée d'une constante technique interne.
 */
export function inSpeakingPosition(node, src) {
  for (let cur = node.parent; cur; cur = cur.parent) {
    if (ts.isJsxExpression(cur)) return true;
    if (ts.isJsxAttribute(cur)) return VISIBLE_PROPS.has(cur.name.getText(src));
    if (ts.isCallExpression(cur)) return SPEAKING_CALLS.test(calleeName(cur.expression));
    // Une déclaration ou un retour de fonction coupe la recherche : au-delà, on ne sait
    // plus si la valeur s'affiche, et deviner produirait des faux positifs en série.
    if (ts.isVariableDeclaration(cur) || ts.isReturnStatement(cur) || ts.isPropertyAssignment(cur)) {
      return false;
    }
  }
  return false;
}

/** Vrai si le nœud est contenu dans un `<code>`, `<pre>`, `<kbd>` ou `<samp>`. */
export function insideCode(node, src) {
  for (let cur = node.parent; cur; cur = cur.parent) {
    if (ts.isJsxElement(cur) && CODE_TAGS.has(cur.openingElement.tagName.getText(src))) return true;
  }
  return false;
}

/**
 * Vrai si le nœud sert à fabriquer une adresse, une classe CSS ou une clé de cache. Ces
 * gabarits-là (`` `/api/versions?taskId=${id}` ``, `` `w-${n} rounded` ``) contiennent des
 * fragments qui ressemblent à des mots sans en être.
 */
export function inTechnicalContext(node, src) {
  for (let cur = node.parent; cur; cur = cur.parent) {
    if (ts.isJsxAttribute(cur) && TECHNICAL_PROPS.test(cur.name.getText(src))) return true;
    if (ts.isCallExpression(cur) && TECHNICAL_CALLS.test(calleeName(cur.expression))) return true;
    if (ts.isPropertyAssignment(cur) && TECHNICAL_PROPS.test(cur.name.getText(src))) return true;
  }
  return false;
}

/** Nom appelé sous forme textuelle : `toast.success`, `window.confirm`, `t`… */
export function calleeName(node) {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return `${calleeName(node.expression)}.${node.name.text}`;
  return '';
}

export function scan(file) {
  const src = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const found = [];
  /**
   * `prose` lève les deux règles qui ne valent que pour du code : « un seul mot en
   * minuscules » et « kebab-case ». Un fragment détaché par une espace (`${n} objets`) ou
   * un texte JSX (`Re-scanner`) est de la prose, quoi qu'il ressemble à un identifiant.
   */
  const push = (text, prose = false) => {
    const clean = text.split(/\s+/).join(' ').trim();
    if (!clean || isAllowed(clean)) return;
    if (isUtilityClasses(clean)) return;
    if (prose ? PROSE_SKIP.some((re) => re.test(clean)) : isIdentifierLike(clean)) return;
    if (!found.includes(clean)) found.push(clean);
  };

  const visit = (node) => {
    if (ts.isJsxText(node)) {
      if (!insideCode(node, src)) push(node.text, true);
    } else if (ts.isJsxAttribute(node) && VISIBLE_PROPS.has(node.name.getText(src))) {
      const value = literalOf(node.initializer);
      if (value) push(value);
    } else if (
      ts.isPropertyAssignment(node) &&
      VISIBLE_PROPS.has(node.name.getText(src).replace(/['"]/g, ''))
    ) {
      // `const FILTERS = [{ value: 'open', label: 'Ouverts' }]` — une table de libellés est
      // du texte d'interface, et c'est là qu'il se cache le plus souvent.
      const value = literalOf(node.initializer);
      if (value) push(value);
    } else if (ts.isCallExpression(node) && SPEAKING_CALLS.test(calleeName(node.expression))) {
      for (const arg of node.arguments) {
        const value = literalOf(arg);
        if (value) push(value);
      }
    } else if (
      ts.isStringLiteral(node) &&
      ts.isJsxExpression(node.parent) &&
      (ts.isJsxElement(node.parent.parent) || ts.isJsxFragment(node.parent.parent))
    ) {
      // `{name ?? 'Anonyme'}` — une valeur de repli affichée telle quelle.
      push(node.text);
    } else if (
      ts.isConditionalExpression(node) &&
      inSpeakingPosition(node, src) &&
      !inTechnicalContext(node, src)
    ) {
      // `{a ? 'Enregistrement…' : t('common.save')}` — la branche en dur atteint l'écran
      // aussi sûrement que l'autre. Le contrôle ne voyait que les ternaires dont les DEUX
      // branches étaient littérales : une seule suffit.
      for (const branch of [node.whenTrue, node.whenFalse]) {
        if (ts.isStringLiteral(branch) || ts.isNoSubstitutionTemplateLiteral(branch)) push(branch.text);
      }
    } else if (
      ts.isBinaryExpression(node) &&
      FALLBACK_OPERATORS.has(node.operatorToken.kind) &&
      inSpeakingPosition(node, src) &&
      !inTechnicalContext(node, src)
    ) {
      // `name ?? 'Anonyme'`, `label || 'Sans titre'` — le repli s'affiche dès que la
      // valeur manque, c'est-à-dire précisément quand on le remarque.
      const right = node.right;
      if (ts.isStringLiteral(right) || ts.isNoSubstitutionTemplateLiteral(right)) push(right.text);
    } else if (ts.isTemplateExpression(node) && !inTechnicalContext(node, src)) {
      // Chaque fragment séparément : `${n} job(s) purgé(s)` n'a de sens qu'en morceaux.
      // Une espace en bord signe la prose autour de l'interpolation.
      const detached = (t) => /^\s|\s$/.test(t);
      push(node.head.text, detached(node.head.text));
      for (const span of node.templateSpans) push(span.literal.text, detached(span.literal.text));
    }
    ts.forEachChild(node, visit);
  };
  visit(src);
  return found;
}

function* sources(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== 'i18n') yield* sources(full);
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      yield full;
    }
  }
}

/** Scanne l'arborescence et rend les textes en dur, groupés par fichier. */
export function collectHardcoded(root = ROOT) {
  const findings = new Map();
  for (const file of sources(root)) {
    const items = scan(file);
    if (items.length) findings.set(file, items);
  }
  return findings;
}

function main() {
  const findings = collectHardcoded();
  const total = [...findings.values()].reduce((n, v) => n + v.length, 0);
  if (process.argv.includes('--list')) {
    for (const [file, items] of [...findings].sort()) {
      console.log(relative(ROOT, file).split(sep).join('/'));
      for (const item of items) console.log('   ', item);
    }
  }

  if (total > CEILING) {
    console.error(
      `\x1b[0;31m✗ ${total} texte(s) d'interface en dur dans ${ROOT} (plafond : ${CEILING}).\x1b[0m`,
    );
    console.error('  Relancer avec --list pour les voir, puis les passer par t().');
    process.exit(1);
  }
  console.log(`\x1b[0;32m✓ textes d'interface en dur : ${total} (plafond ${CEILING})\x1b[0m`);
}

// Importable pour les tests ; exécuté seulement quand on l'appelle directement.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Detects hard-coded interface text in the frontend — that is, anything displayed without going
 * through `t()`.
 *
 * Two generations of this check failed before this one, each because it looked for the wrong thing:
 *   1. the first only read JSX text fitting on one line — anything Prettier wrapped escaped it;
 *   2. the second looked for *French markers* (accents, function words). Yet "Port", "Cadence",
 *      "Objets", "Commentaires", "Note", "Import CSV" carry none: the interface stayed half French
 *      in Chinese with a green check.
 *
 * Hence the criterion kept here, which depends on no language: **any literal that reaches the
 * screen is a fault**, whatever language it is written in. The TypeScript AST is analysed rather
 * than regular expressions, and we report:
 *   - JSX text (`<p>Hello</p>`);
 *   - props that are displayed or read aloud (`title`, `placeholder`, `aria-label`, `label`, `alt`…);
 *   - literals passed to functions that speak to the user (`toast.*`, `confirm`);
 *   - the templates `` `${n} file(s) deleted` ``, wherever they are: a sentence around an
 *     interpolation is interface text, and that shape was the one most often escaping the previous checks.
 *
 * What is not interface text (identifiers, CSS classes, units, acronyms, proper nouns) is set aside by
 * `ALLOWED` and `SKIP` — explicitly, not by guesswork.
 *
 * The total is compared to a ceiling (`CEILING`): the suite fails if it rises. Lower the ceiling when
 * going down, never the other way.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { join, relative, resolve, sep } from 'node:path';

// TypeScript is not installed at the root: we borrow the frontend's, which already serves
// the typecheck. No new dependency, hence no new licence obligation.
const ts = createRequire(resolve('frontend/package.json'))('typescript');

/**
 * Controlled trees.
 *
 * The backend was ABSENT — only one directory was scanned. Yet it has its own i18n
 * (`backend/src/i18n`), and the project rule covers both halves: "all visible text goes through
 * `t()` (`v2/i18n` front, `src/i18n` back)". Everything the server renders to a human — footer of
 * `/api/docs`, email bodies, public pages — therefore escaped the ceiling, which measured half the
 * product while announcing the whole.
 */
const ROOTS = ['frontend/src', 'backend/src'];

/**
 * Backend debt found when entering the scope. To be lowered, never raised.
 *
 * This figure is a BASELINE, not a relaxation: the backend had not been checked at all until now.
 * What it covers is almost entirely outside the interface — SVG assembly, FFmpeg filters, SQL
 * fragments, log messages meant for the operator, ShotGrid error texts. The surfaces really read by
 * a user are at zero and go through `t()`: public footer of `/api/docs`, unsubscribe page, emails.
 *
 * 2026-09-16: 343 -> 332. The TAGGED templates (`Prisma.sql`, see `TECHNICAL_TAGS`) are no longer
 * counted — a parameterised query had until then declared as many "hard-coded texts" as it had
 * fragments, which pushed people to concatenate SQL to satisfy the check. The ceiling drops by as
 * much: what remains is real debt, not noise.
 *
 * 2026-09-20: 332 -> 330. The service and the router of the video cutting were removed along with
 * the feature (Phase 50, lot 4); their error messages went with them.
 */
const BACKEND_DEBT = 330;

/**
 * Tolerated remainder **per tree** — debt to be paid down, never raised.
 *
 * The front end is at zero and must stay there. The backend enters the scope with a debt: it had
 * not been checked at all, and most of what is found there has no business in a catalogue (SVG
 * assembly, FFmpeg filters, SQL fragments, operator logs). The ceiling therefore freezes what exists
 * so that nothing gets added, while the surfaces really read by a human — public footer, emails,
 * invitations — go through `t()`.
 */
const CEILINGS = { 'frontend/src': 0, 'backend/src': BACKEND_DEBT };

/**
 * Tags whose content is technical literal rather than prose: a command, an HTTP header, a bucket
 * prefix, a key. Putting the text there is the *correct* way to say "this does not translate" — the
 * check relies on it rather than guessing.
 */
const CODE_TAGS = new Set(['code', 'pre', 'kbd', 'samp']);

/** Props whose value reaches the user (on screen or through a screen reader). */
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
  // A keyboard shortcut is written as a LIST of keys (`keys={['Espace', 'Maj']}`), and the
  // prop escaped the check for this reason alone: it was not called `label`.
  // The key names therefore stayed in French in the thirteen other catalogues.
  'keys',
  'label',
  'message',
  'placeholder',
  'subtitle',
  'title',
  'tooltip',
]);

/** Functions that display their argument as is. */
const SPEAKING_CALLS = /^(toast(\.\w+)?|confirm|alert|prompt|window\.(confirm|alert|prompt))$/;

/** Props whose value is an address, a class or an identifier — never prose. */
const TECHNICAL_PROPS =
  /^(className|class|style|id|key|href|src|srcSet|to|type|name|value|htmlFor|accept|pattern|role|d|points|viewBox|data-.*|aria-(hidden|controls|labelledby|describedby))$/;

/**
 * Technical props **only on a native HTML tag**.
 *
 * `value` is the example that cost dearly: on `<input>` or `<option>` it is data, but on a home-made
 * component (`<Row value=…>`, `<Metric value=…>`) it is displayed prose. Classing `value` as technical
 * without looking at the tag let "SQ### / SH### (pas 10)" through on a full administration page. The
 * distinction is JSX's: lowercase = DOM element, uppercase = component.
 */
const NATIVE_ONLY_PROPS = /^(value|name|type|role)$/;

/**
 * Props and option keys whose value is a **discriminant**, never prose: a component's variant
 * (`variant="destructive"`), a scope, an `Intl` option (`{ month: 'long' }`), an SVG paint attribute.
 *
 * These names are needed since the check no longer relies on the word's look alone: "destructive" and
 * "numeric" look exactly like "approbation" (approval).
 */
const DISCRIMINANT_PROPS =
  /^(variant|scope|kind|mode|side|align|tone|level|status|size|entity|fill|stroke|strokeLinecap|strokeLinejoin|weekday|era|year|month|day|hour|minute|second|timeZoneName|dateStyle|timeStyle|numeric|unit|unitDisplay|currency|notation|display|position|behavior|block|inline|aria-current)$/;

/**
 * Calls whose arguments are URLs, cache keys, traces — or CSS SELECTORS.
 *
 * `querySelector` and its family take a selector, never prose: without this entry, an interpolated
 * selector (`[data-index="${i}"]`) is counted as interface text, which pushes people to write it by
 * concatenation — less readable code that the first reviewer "cleans up" into a template, reopening
 * the false positive. The caller declares the nature of the literal.
 */
const TECHNICAL_CALLS =
  /^(api\.\w+|fetch|navigate|qk(\.\w+)?|URL|URLSearchParams|encodeURI\w*|decodeURI\w*|console\.\w+|(local|session)Storage\.\w+|require|import|(\w+\.)*(querySelector|querySelectorAll|closest|matches|getAttribute|setAttribute|removeAttribute))$/;

/**
 * TAGGED templates that declare a language, not prose.
 *
 * On the JSX side, `<code>`/`<pre>`/`<kbd>` are the way to write "this does not translate". On the
 * backend, the tag of the template says it: `Prisma.sql\`SELECT …\`` will never contain a sentence
 * meant for a reader. Without this exemption, a parameterised SQL query — the ONLY safe form, since
 * Prisma binds the values there — counts as many "hard-coded texts" as it has fragments, which pushes
 * people to write concatenated SQL to satisfy the check.
 *
 * The exemption is deliberately by name: only a tag in this list is exempted. An unknown tag remains
 * counted, and so does a plain string placed next to a tagged template.
 */
const TECHNICAL_TAGS = /^(\w+\.)?(sql|raw|css|html|gql|graphql|\$queryRaw|\$executeRaw)$/;

/**
 * Texts that reach the screen but do not translate: units, acronyms, proper nouns, production
 * vocabulary (see `scripts/i18n-glossary.json`). Any entry added here must be a word that no language
 * would render otherwise.
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
    // Three.js class name displayed as is (`MeshStandardMaterial`, failing that `Material`).
    'Material',
    // acronyms and formats
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
    // VFX department names: production vocabulary, written in English in every
    // studio — which is in fact how the studio names them in its own
    // departments ("Look Dev", "Modeling"). Translating them would make the fallback
    // enum diverge from the real reference list.
    'Animation',
    'Compositing',
    'Lighting',
    'Modeling',
    'Rigging',
    'Look',
    'Dev',
    'Layout',
    // units
    'px',
    'fps',
    'ms',
    's',
    // "Ko", "Mo", "Go" and "To" were REMOVED: they are the French symbols, and English
    // renders them "KB", "MB", "GB", "TB". The contract of this list — "a word no language
    // would render otherwise" — did not cover them, and their presence here let a French byte
    // formatter through for months, across the seven administration screens using it. Sizes now go
    // through `lib/formatBytes`, which renders them via `Intl.NumberFormat`.
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
    // keys and interface symbols
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
    // production vocabulary never translated
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
 * What looks like text without being text: identifiers, paths, classes, CSS templates.
 * These values live in visible props (a computed `label`, an icon's `title`) or in
 * purely structural JSX.
 */
const SKIP = [
  /^[\p{P}\p{S}\p{N}\s]*$/u, // no letters: punctuation, digits, symbols
  /^(https?:|mailto:|data:|blob:|\/|\.{1,2}\/|#)/, // URL, path, anchor
  /^[a-z0-9]+([-_:][a-z0-9]+)+$/i, // kebab / snake / namespaced: classes, keys, events
  /^[a-z][a-zA-Z0-9]*$/, // camelCase or a lone lowercase word: identifier
  /^[A-Z0-9_]+$/, // SCREAMING_SNAKE
  /^\w+\.\w+/, // dot.case: translation key, property path
  /^\d/, // starts with a digit: format, dimension
  /(sans-serif|serif|monospace|var\(--|rgba?\(|#[0-9a-f]{3,8}\b)/i, // CSS
  /^[\w.+-]+@[\w-]+\.[a-z]{2,}$/i, // example email address
  /^[\w-]+\/$/, // bucket prefix (`derived/`)
  /[\\^$]|\\[dwsn]|\{\d+,?\d*\}/, // regular expression given as an example
  /^[?&#]|^\w+=$|[?&]\w+=/, // query string fragment (`?frame=`, `&live=1`)
  /^[\w-]*\.[a-z0-9]{2,4}$/i, // file name suffix (`-frame.jpg`)
  /^[\w-]+[-_=]$/, // identifier prefix (`seq-`, `project-`)
  /^\.\w/, // property access (shaders, Spark dyno)
  /^[\w:-]+[:.]$/, // channel or key prefix (`task:`, `review:tree:`, `onboarding.`)
  /<\/?[a-z][\w-]*[\s/>]/i, // HTML or SVG tag assembled by hand
  /[;{}]|^[-+*/%<>=!&|]\s|^\)|\w\($/, // code: statement, leading operator, call
  /\b(float|vec[234]|int|uint|mat[234]|gl_\w+)\b/, // GLSL
  /\b(translate|scale|rotate|matrix|calc|url)\(/i, // CSS function
  /^[a-z][\w-]*\([^)]*\)$/i, // full CSS value (`polygon(0 0, 0 0, 0 0)`)
  /^[a-z]+\/[a-z0-9.+-]+$/i, // MIME type (`application/octet-stream`)
];

/** A stack of utility classes: all lowercase, with at least one internal `-`/`[`. */
export const isUtilityClasses = (text) => {
  const words = text.split(' ');
  return (
    words.length > 1 &&
    words.every((w) => /^[a-z0-9:./[\]%#!-]+$/.test(w)) &&
    words.some((w) => /[-[]/.test(w))
  );
};

export const isIdentifierLike = (text) => SKIP.some((re) => re.test(text)) || isUtilityClasses(text);

/** Same filter, without the two rules that would confuse an ordinary word with an identifier. */
const IDENTIFIER_ONLY = [/^[a-z0-9]+([-_:][a-z0-9]+)+$/i, /^[a-z][a-zA-Z0-9]*$/];
const PROSE_SKIP = SKIP.filter((re) => !IDENTIFIER_ONLY.some((id) => id.source === re.source));

export function isAllowed(text) {
  const clean = text.replace(/[\p{P}\p{S}\p{N}]/gu, ' ').trim();
  if (!clean) return true;
  return clean.split(/\s+/).every((word) => ALLOWED.has(word.toLowerCase()));
}

/** A string literal or a template without interpolation; otherwise `null`. */
export function literalOf(node) {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isJsxExpression(node)) return literalOf(node.expression);
  // `cond ? 'Oui' : 'Non'` — both branches count; they are returned together.
  if (ts.isConditionalExpression(node)) {
    const parts = [literalOf(node.whenTrue), literalOf(node.whenFalse)].filter(Boolean);
    return parts.length ? parts.join(' / ') : null;
  }
  return null;
}

/**
 * The literals a visible prop receives — a single one, or a whole **list**.
 *
 * `keys={['Espace', 'Maj']}`: the check used to stop at the opening bracket, and the key names of the
 * shortcut help stayed in French in the thirteen other catalogues throughout the i18n migration. Each
 * element is returned **separately**: a list of keys is not a sentence, and gluing them end to end would
 * make `['Ctrl', 'K']` — two names nobody translates — pass as interface text.
 */
export function literalsOf(node) {
  const inner = node && ts.isJsxExpression(node) ? node.expression : node;
  if (inner && ts.isArrayLiteralExpression(inner)) return inner.elements.map(literalOf).filter(Boolean);
  const single = literalOf(node);
  return single ? [single] : [];
}

/** `??` and `||`: the two ways of writing a fallback value. */
const FALLBACK_OPERATORS = new Set([ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken]);

/**
 * Names that announce interface text: `statusLabel`, `formatDuration`, `errorText`,
 * `VERSION_STATUS_LABEL`. They complement the `: string` annotation, which the code does not always
 * write — and they also name the label tables, where the text hides most.
 */
const UI_TEXT_NAME = /(^|[a-z_])(label|text|title|message|caption|wording)s?$|^format[A-Z]/i;

const declaredName = (fn) => {
  if (fn.name && ts.isIdentifier(fn.name)) return fn.name.text;
  // `const statusLabel = (...) => …`: the name is carried by the declaration.
  const parent = fn.parent;
  if (parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
  return '';
};

/**
 * Does the function return text meant for the screen? The detector used to stop at the edge of
 * every function, and five French labels were displayed on each upload behind a `switch`: a table
 * of labels is interface text, wherever it is written. Two signs suffice, both syntactic (this check
 * has no type checker): the announced return type `string`, or a name that says what it returns.
 */
export function returnsUiText(fn) {
  if (fn.type && fn.type.kind === ts.SyntaxKind.StringKeyword) return true;
  return UI_TEXT_NAME.test(declaredName(fn));
}

/** Nearest enclosing function, or `null` at module level. */
export function enclosingFunction(node) {
  for (let cur = node.parent; cur; cur = cur.parent) if (ts.isFunctionLike(cur)) return cur;
  return null;
}

/**
 * Does the node belong to a **label table** — `const VERSION_STATUS_LABEL = {
 * REVIEW: 'En review' }`? The key there is a business identifier (`REVIEW`), so none of the rules
 * based on the property name sees the text: it is the table's name that says what it contains.
 */
export function inLabelTable(node) {
  for (let cur = node.parent; cur; cur = cur.parent) {
    if (ts.isFunctionLike(cur)) return false;
    if (ts.isVariableDeclaration(cur)) {
      return ts.isIdentifier(cur.name) && UI_TEXT_NAME.test(cur.name.text);
    }
  }
  return false;
}

/**
 * Does the node end up on screen? True if it is rendered by JSX, passed to a label prop or to a
 * speaking call (`toast`, `confirm`…). This is what distinguishes a displayed fallback value from an
 * internal technical constant.
 */
export function inSpeakingPosition(node, src) {
  for (let cur = node.parent; cur; cur = cur.parent) {
    if (ts.isJsxExpression(cur)) return true;
    if (ts.isJsxAttribute(cur)) return VISIBLE_PROPS.has(cur.name.getText(src));
    if (ts.isCallExpression(cur)) return SPEAKING_CALLS.test(calleeName(cur.expression));
    // Value returned by a function: speaking if the function returns interface text
    // (`statusLabel()`, `(): string`). This used to be the check's main blind spot.
    if (ts.isReturnStatement(cur)) {
      const fn = enclosingFunction(cur);
      return fn ? returnsUiText(fn) : false;
    }
    if (ts.isArrowFunction(cur)) return returnsUiText(cur);
    // A declaration ends the search: beyond it we no longer know whether the value
    // is displayed, and guessing would produce false positives in series.
    if (ts.isVariableDeclaration(cur) || ts.isPropertyAssignment(cur)) return false;
  }
  return false;
}

/** True if the node is contained in a `<code>`, `<pre>`, `<kbd>` or `<samp>`. */
export function insideCode(node, src) {
  for (let cur = node.parent; cur; cur = cur.parent) {
    if (ts.isJsxElement(cur) && CODE_TAGS.has(cur.openingElement.tagName.getText(src))) return true;
  }
  return false;
}

/**
 * True if the node is used to build an address, a CSS class or a cache key. Those templates
 * (`` `/api/versions?taskId=${id}` ``, `` `w-${n} rounded` ``) contain fragments that look like
 * words without being any.
 */
export function inTechnicalContext(node, src) {
  let previous = node;
  for (let cur = node.parent; cur; previous = cur, cur = cur.parent) {
    if (ts.isJsxAttribute(cur) && TECHNICAL_PROPS.test(cur.name.getText(src))) {
      // `value` on a home-made component CAN carry prose (`<Row value={\`… (pas 10)\`}>`).
      // The exemption is only lifted for text with that shape: a sentence, or an interpolated
      // template. A lone word (`value="cards"`, `value="invite"`) stays a discriminant.
      if (
        NATIVE_ONLY_PROPS.test(cur.name.getText(src)) &&
        !isNativeJsxElement(cur, src) &&
        looksLikeProse(node)
      ) {
        continue;
      }
      return true;
    }
    if (ts.isJsxAttribute(cur) && DISCRIMINANT_PROPS.test(cur.name.getText(src))) return true;
    if (ts.isCallExpression(cur) && TECHNICAL_CALLS.test(calleeName(cur.expression))) return true;
    if (ts.isTaggedTemplateExpression(cur) && TECHNICAL_TAGS.test(calleeName(cur.tag))) return true;
    if (ts.isPropertyAssignment(cur) && TECHNICAL_PROPS.test(cur.name.getText(src))) return true;
    if (ts.isPropertyAssignment(cur) && DISCRIMINANT_PROPS.test(cur.name.getText(src))) return true;
    // A COMPARED literal is never displayed: `tool === 'erase'`, `case 'move':`. The word
    // looks like prose, but it never leaves the code.
    //
    // For `case`, only the LABEL is excluded — certainly not the body of the clause, where lives
    // precisely the `return 'En attente…'` that this check must catch.
    if (ts.isBinaryExpression(cur) && isComparison(cur)) return true;
    if (ts.isCaseClause(cur)) return cur.expression === previous;
  }
  return false;
}

/** True for `===`, `!==`, `==`, `!=` — the operators that compare without displaying. */
export function isComparison(node) {
  const kind = node.operatorToken.kind;
  return (
    kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
    kind === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
    kind === ts.SyntaxKind.EqualsEqualsToken ||
    kind === ts.SyntaxKind.ExclamationEqualsToken
  );
}

/**
 * Does this node have the shape of a sentence rather than of a discriminant?
 *
 * An interpolated template or a multi-word text is prose; a lone word is an identifier. This is what
 * separates `` `SQ### / SH### (pas ${step})` `` — French displayed on a full administration page —
 * from `value="cards"`.
 */
export function looksLikeProse(node) {
  if (!node) return false;
  if (ts.isTemplateExpression(node) || ts.isNoSubstitutionTemplateLiteral(node)) return true;
  if (ts.isStringLiteral(node)) return /\s/.test(node.text.trim());
  return true;
}

/**
 * Is the tag carrying this attribute a native DOM element?
 *
 * JSX decides on case: `<div>`, `<input>`, `<option>` are elements; `<Row>`, `<Metric>`, `<Badge>`
 * are components, whose props can carry prose.
 */
export function isNativeJsxElement(attribute, src) {
  for (let cur = attribute.parent; cur; cur = cur.parent) {
    if (ts.isJsxOpeningElement(cur) || ts.isJsxSelfClosingElement(cur)) {
      const tag = cur.tagName.getText(src);
      return /^[a-z]/.test(tag);
    }
  }
  return false;
}

/** Called name in textual form: `toast.success`, `window.confirm`, `t`… */
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
   * `prose` lifts the two rules that only hold for code: "a single lowercase word" and
   * "kebab-case". A fragment set apart by a space (`${n} objets`) or a JSX text (`Re-scanner`) is
   * prose, however much it looks like an identifier.
   */
  const push = (text, prose = false) => {
    const clean = text.split(/\s+/).join(' ').trim();
    if (!clean || isAllowed(clean)) return;
    if (isUtilityClasses(clean)) return;
    if (prose ? PROSE_SKIP.some((re) => re.test(clean)) : isIdentifierLike(clean)) return;
    if (!found.includes(clean)) found.push(clean);
  };

  const visit = (node) => {
    // `const LABELS = { DRAFT: t('reviews.draft') }` — evaluated at import, that is,
    // before the language catalogue arrives (only English is embedded) and never
    // re-evaluated afterwards: the table stays English for ever. The same fault as hard-coded
    // text, in another form — the table should become a function taking `t`.
    if (
      ts.isCallExpression(node) &&
      /^(t|tr)$/.test(calleeName(node.expression)) &&
      !enclosingFunction(node)
    ) {
      const key = literalOf(node.arguments[0]) ?? '?';
      const item = `t('${key}') hors fonction — langue figée à l'import`;
      if (!found.includes(item)) found.push(item);
    }

    if (ts.isJsxText(node)) {
      if (!insideCode(node, src)) push(node.text, true);
    } else if (ts.isJsxAttribute(node) && VISIBLE_PROPS.has(node.name.getText(src))) {
      for (const value of literalsOf(node.initializer)) push(value);
    } else if (
      ts.isPropertyAssignment(node) &&
      (VISIBLE_PROPS.has(node.name.getText(src).replace(/['"]/g, '')) || inLabelTable(node))
    ) {
      // `const FILTERS = [{ value: 'open', label: 'Ouverts' }]` — a label table is
      // interface text, and that is where it most often hides.
      //
      // The technical context applies here too: a variable named `monthLabel` makes
      // `{ month: 'long', year: 'numeric' }` pass for a label table, whereas those
      // are the options of `Intl.DateTimeFormat`.
      if (!inTechnicalContext(node, src)) for (const value of literalsOf(node.initializer)) push(value);
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
      // `{name ?? 'Anonyme'}` — a fallback value displayed as is.
      push(node.text);
    } else if (
      ts.isConditionalExpression(node) &&
      inSpeakingPosition(node, src) &&
      !inTechnicalContext(node, src)
    ) {
      // `{a ? 'Enregistrement…' : t('common.save')}` — the hard-coded branch reaches the screen
      // just as surely as the other. The check only saw ternaries whose TWO
      // branches were literal: one is enough.
      for (const branch of [node.whenTrue, node.whenFalse]) {
        if (ts.isStringLiteral(branch) || ts.isNoSubstitutionTemplateLiteral(branch)) push(branch.text);
      }
    } else if (
      ts.isBinaryExpression(node) &&
      FALLBACK_OPERATORS.has(node.operatorToken.kind) &&
      inSpeakingPosition(node, src) &&
      !inTechnicalContext(node, src)
    ) {
      // `name ?? 'Anonyme'`, `label || 'Sans titre'` — the fallback is displayed as soon as the
      // value is missing, that is, precisely when one notices it.
      const right = node.right;
      if (ts.isStringLiteral(right) || ts.isNoSubstitutionTemplateLiteral(right)) push(right.text);
    } else if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      (ts.isReturnStatement(node.parent) || ts.isArrowFunction(node.parent)) &&
      inSpeakingPosition(node, src) &&
      !inTechnicalContext(node, src)
    ) {
      // `function statusLabel(u): string { … return 'En attente…' }` — the value is displayed
      // one line further, next to branches that do call `t()`.
      push(node.text);
    } else if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.PlusToken &&
      inSpeakingPosition(node, src) &&
      !inTechnicalContext(node, src)
    ) {
      // `'Supprimer ' + n + ' fichiers'` — the same sentence as a template, written differently.
      for (const side of [node.left, node.right]) {
        if (ts.isStringLiteral(side) || ts.isNoSubstitutionTemplateLiteral(side)) {
          push(side.text, /^\s|\s$/.test(side.text));
        }
      }
    } else if (ts.isTemplateExpression(node) && !inTechnicalContext(node, src)) {
      // Each fragment separately: `${n} job(s) purgé(s)` only makes sense in pieces.
      // A space at the edge marks the prose around the interpolation.
      const detached = (t) => /^\s|\s$/.test(t);
      push(node.head.text, detached(node.head.text));
      for (const span of node.templateSpans) push(span.literal.text, detached(span.literal.text));
    }
    ts.forEachChild(node, visit);
  };
  visit(src);
  return found;
}

/**
 * Directories out of scope: the catalogues themselves, and everything never addressed to a user —
 * integration test benches (fixtures, test accounts, assertion messages) and configuration validation,
 * which speaks to the operator in the startup logs, not on screen.
 */
const SKIPPED_DIRS = new Set(['i18n', 'integration', 'config', 'types']);

function* sources(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (!SKIPPED_DIRS.has(entry)) yield* sources(full);
    } else if (/\.tsx?$/.test(entry) && !/\.(test|itest)\.tsx?$/.test(entry)) {
      yield full;
    }
  }
}

/** Scans the tree and returns the hard-coded texts, grouped by file. */
export function collectHardcoded(roots = ROOTS) {
  const findings = new Map();
  for (const root of Array.isArray(roots) ? roots : [roots]) {
    for (const file of sources(root)) {
      const items = scan(file);
      if (items.length) findings.set(file, items);
    }
  }
  return findings;
}

function main() {
  const findings = collectHardcoded();
  if (process.argv.includes('--list')) {
    for (const [file, items] of [...findings].sort()) {
      console.log(relative(resolve('.'), file).split(sep).join('/'));
      for (const item of items) console.log('   ', item);
    }
  }

  // One ceiling PER tree: the front end stays at zero, the backend comes in with its debt.
  // A single total would let a front-end regression hide behind the backend's debt.
  let failed = false;
  for (const root of ROOTS) {
    const prefix = resolve(root);
    const total = [...findings]
      .filter(([file]) => resolve(file).startsWith(prefix))
      .reduce((n, [, items]) => n + items.length, 0);
    const ceiling = CEILINGS[root] ?? 0;
    if (total > ceiling) {
      failed = true;
      console.error(`[0;31m✗ ${total} texte(s) d'interface en dur dans ${root} (plafond : ${ceiling}).[0m`);
    } else {
      console.log(`[0;32m✓ ${root} : ${total} texte(s) en dur (plafond ${ceiling})[0m`);
    }
  }
  if (failed) {
    console.error('  Relancer avec --list pour les voir, puis les passer par t().');
    process.exit(1);
  }
}

// Importable for the tests; only runs when called directly.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

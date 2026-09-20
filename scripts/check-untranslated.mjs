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

/**
 * Arborescences contrôlées.
 *
 * Le backend en était ABSENT — un seul répertoire était scanné. Or il a sa propre i18n
 * (`backend/src/i18n`), et la règle du projet vise les deux moitiés : « tout texte visible
 * passe par `t()` (`v2/i18n` front, `src/i18n` back) ». Tout ce que le serveur rend à un
 * humain — pied de page de `/api/docs`, corps des e-mails, pages publiques — échappait donc
 * au plafond, qui mesurait une moitié du produit en annonçant le tout.
 */
const ROOTS = ['frontend/src', 'backend/src'];

/**
 * Dette backend constatée à l'entrée dans le périmètre. À faire baisser, jamais monter.
 *
 * Ce chiffre est une LIGNE DE BASE, pas un relâchement : le backend n'était pas contrôlé du
 * tout jusqu'ici. Ce qu'il recouvre est presque entièrement hors interface — assemblage SVG,
 * filtres FFmpeg, fragments SQL, messages de journal destinés à l'exploitant, textes d'erreur
 * ShotGrid. Les surfaces réellement lues par un utilisateur, elles, sont à zéro et passent
 * par `t()` : pied de page public de `/api/docs`, page de désabonnement, e-mails.
 *
 * 2026-09-16 : 343 -> 332. Les gabarits BALISÉS (`Prisma.sql`, cf. `TECHNICAL_TAGS`) ne sont
 * plus comptés — une requête paramétrée déclarait jusqu'ici autant de « textes en dur »
 * qu'elle avait de fragments, ce qui poussait à concaténer le SQL pour satisfaire le contrôle.
 * Le plafond descend d'autant : ce qu'il reste est de la dette réelle, pas du bruit.
 *
 * 2026-09-20 : 332 -> 330. Le service et le routeur de la découpe vidéo ont été supprimés
 * avec la fonctionnalité (Phase 50, lot 4) ; leurs messages d'erreur partent avec eux.
 */
const BACKEND_DEBT = 330;

/**
 * Reliquat toléré **par arborescence** — dette à résorber, jamais à relever.
 *
 * Le front est à zéro et doit y rester. Le backend entre dans le périmètre avec une dette :
 * il n'était pas contrôlé du tout, et l'essentiel de ce qu'on y trouve n'a rien à faire dans
 * un catalogue (assemblage SVG, filtres FFmpeg, fragments SQL, journaux d'exploitation). Le
 * plafond fige donc l'existant pour que rien ne s'ajoute, pendant que les surfaces réellement
 * lues par un humain — pied de page public, e-mails, invitations — passent par `t()`.
 */
const CEILINGS = { 'frontend/src': 0, 'backend/src': BACKEND_DEBT };

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

/**
 * Props techniques **seulement sur une balise HTML native**.
 *
 * `value` est l'exemple qui a coûté cher : sur `<input>` ou `<option>` c'est une donnée, mais
 * sur un composant maison (`<Row value=…>`, `<Metric value=…>`) c'est de la prose affichée.
 * Classer `value` technique sans regarder la balise laissait passer « SQ### / SH### (pas 10) »
 * en pleine page d'administration. La distinction est celle de JSX : minuscule = élément du
 * DOM, majuscule = composant.
 */
const NATIVE_ONLY_PROPS = /^(value|name|type|role)$/;

/**
 * Props et clés d'option dont la valeur est un **discriminant**, jamais de la prose : la
 * variante d'un composant (`variant="destructive"`), une portée, une option `Intl`
 * (`{ month: 'long' }`), un attribut SVG de peinture.
 *
 * Ces noms sont nécessaires depuis que le contrôle ne se fie plus au seul aspect du mot :
 * « destructive » et « numeric » ressemblent trait pour trait à « approbation ».
 */
const DISCRIMINANT_PROPS =
  /^(variant|scope|kind|mode|side|align|tone|level|status|size|entity|fill|stroke|strokeLinecap|strokeLinejoin|weekday|era|year|month|day|hour|minute|second|timeZoneName|dateStyle|timeStyle|numeric|unit|unitDisplay|currency|notation|display|position|behavior|block|inline|aria-current)$/;

/**
 * Appels dont les arguments sont des URL, des clés de cache, des traces — ou des SÉLECTEURS CSS.
 *
 * `querySelector` et sa famille prennent un sélecteur, jamais de la prose : sans cette entrée, un
 * sélecteur interpolé (`[data-index="${i}"]`) est compté comme un texte d'interface, ce qui pousse
 * à l'écrire par concaténation — un code moins lisible que le premier relecteur « nettoiera » en
 * gabarit, rouvrant le faux positif. C'est l'appelant qui déclare la nature du littéral.
 */
const TECHNICAL_CALLS =
  /^(api\.\w+|fetch|navigate|qk(\.\w+)?|URL|URLSearchParams|encodeURI\w*|decodeURI\w*|console\.\w+|(local|session)Storage\.\w+|require|import|(\w+\.)*(querySelector|querySelectorAll|closest|matches|getAttribute|setAttribute|removeAttribute))$/;

/**
 * Gabarits BALISÉS qui déclarent un langage, pas de la prose.
 *
 * Côté JSX, `<code>`/`<pre>`/`<kbd>` sont la façon d'écrire « ceci ne se traduit pas ». Côté
 * backend, c'est la balise du gabarit qui le dit : `Prisma.sql\`SELECT …\`` ne contiendra
 * jamais une phrase destinée à un lecteur. Sans cette exemption, une requête SQL paramétrée —
 * la SEULE forme sûre, puisque Prisma y lie les valeurs — compte autant de « textes en dur »
 * qu'elle a de fragments, ce qui pousse à écrire du SQL concaténé pour satisfaire le contrôle.
 *
 * L'exemption est volontairement nominative : seule une balise de cette liste exempte. Une
 * balise inconnue reste comptée, et une chaîne simple posée à côté d'un gabarit balisé aussi.
 */
const TECHNICAL_TAGS = /^(\w+\.)?(sql|raw|css|html|gql|graphql|\$queryRaw|\$executeRaw)$/;

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
    // Nom de classe Three.js affiché tel quel (`MeshStandardMaterial`, à défaut `Material`).
    'Material',
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
    // Noms de département VFX : vocabulaire de production, écrit en anglais dans tous les
    // studios — c'est d'ailleurs ainsi que le studio les nomme dans ses propres
    // départements (« Look Dev », « Modeling »). Les traduire ferait diverger l'enum de
    // repli du référentiel réel.
    'Animation',
    'Compositing',
    'Lighting',
    'Modeling',
    'Rigging',
    'Look',
    'Dev',
    'Layout',
    // unités
    'px',
    'fps',
    'ms',
    's',
    // « Ko », « Mo », « Go » et « To » ont été RETIRÉS : ce sont les symboles français, et
    // l'anglais les rend « KB », « MB », « GB », « TB ». Le contrat de cette liste — « un mot
    // qu'aucune langue ne rendrait autrement » — ne les couvrait pas, et leur présence ici a
    // laissé passer pendant des mois un formateur d'octets écrit en français dans les sept
    // écrans d'administration qui l'utilisaient. Les tailles passent désormais par
    // `lib/formatBytes`, qui les rend via `Intl.NumberFormat`.
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
  /^[a-z][\w-]*\([^)]*\)$/i, // valeur CSS complète (`polygon(0 0, 0 0, 0 0)`)
  /^[a-z]+\/[a-z0-9.+-]+$/i, // type MIME (`application/octet-stream`)
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
 * Noms qui annoncent un texte d'interface : `statusLabel`, `formatDuration`, `errorText`,
 * `VERSION_STATUS_LABEL`. Ils complètent l'annotation `: string`, que le code n'écrit pas
 * toujours — et nomment aussi les tables de libellés, où le texte se cache le plus.
 */
const UI_TEXT_NAME = /(^|[a-z_])(label|text|title|message|caption|wording)s?$|^format[A-Z]/i;

const declaredName = (fn) => {
  if (fn.name && ts.isIdentifier(fn.name)) return fn.name.text;
  // `const statusLabel = (...) => …` : le nom est porté par la déclaration.
  const parent = fn.parent;
  if (parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
  return '';
};

/**
 * La fonction rend-elle du texte destiné à l'écran ? Le détecteur s'arrêtait au bord de
 * toute fonction, et cinq libellés français s'affichaient à chaque upload derrière un
 * `switch` : une table de libellés est du texte d'interface, où qu'elle soit écrite.
 * Deux signes suffisent, tous deux syntaxiques (ce contrôle n'a pas de vérificateur de
 * types) : le type de retour annoncé `string`, ou un nom qui dit ce qu'il rend.
 */
export function returnsUiText(fn) {
  if (fn.type && fn.type.kind === ts.SyntaxKind.StringKeyword) return true;
  return UI_TEXT_NAME.test(declaredName(fn));
}

/** Fonction englobante la plus proche, ou `null` au niveau du module. */
export function enclosingFunction(node) {
  for (let cur = node.parent; cur; cur = cur.parent) if (ts.isFunctionLike(cur)) return cur;
  return null;
}

/**
 * Le nœud appartient-il à une **table de libellés** — `const VERSION_STATUS_LABEL = {
 * REVIEW: 'En review' }` ? La clé y est un identifiant métier (`REVIEW`), donc aucune des
 * règles fondées sur le nom de la propriété ne voit le texte : c'est le nom de la table
 * qui dit ce qu'elle contient.
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
 * Le nœud aboutit-il à l'écran ? Vrai s'il est rendu par du JSX, passé à une prop de
 * libellé ou à un appel parlant (`toast`, `confirm`…). C'est ce qui distingue une valeur
 * de repli affichée d'une constante technique interne.
 */
export function inSpeakingPosition(node, src) {
  for (let cur = node.parent; cur; cur = cur.parent) {
    if (ts.isJsxExpression(cur)) return true;
    if (ts.isJsxAttribute(cur)) return VISIBLE_PROPS.has(cur.name.getText(src));
    if (ts.isCallExpression(cur)) return SPEAKING_CALLS.test(calleeName(cur.expression));
    // Valeur rendue par une fonction : parlante si la fonction rend du texte d'interface
    // (`statusLabel()`, `(): string`). C'était l'angle mort principal du contrôle.
    if (ts.isReturnStatement(cur)) {
      const fn = enclosingFunction(cur);
      return fn ? returnsUiText(fn) : false;
    }
    if (ts.isArrowFunction(cur)) return returnsUiText(cur);
    // Une déclaration coupe la recherche : au-delà, on ne sait plus si la valeur
    // s'affiche, et deviner produirait des faux positifs en série.
    if (ts.isVariableDeclaration(cur) || ts.isPropertyAssignment(cur)) return false;
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
  let previous = node;
  for (let cur = node.parent; cur; previous = cur, cur = cur.parent) {
    if (ts.isJsxAttribute(cur) && TECHNICAL_PROPS.test(cur.name.getText(src))) {
      // `value` sur un composant maison PEUT porter de la prose (`<Row value={\`… (pas 10)\`}>`).
      // On ne lève l'exemption que pour un texte qui en a la forme : une phrase, ou un gabarit
      // interpolé. Un mot isolé (`value="cards"`, `value="invite"`) reste un discriminant.
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
    // Un littéral COMPARÉ n'est jamais affiché : `tool === 'erase'`, `case 'move':`. Le mot
    // ressemble à de la prose, mais il ne quitte jamais le code.
    //
    // Pour `case`, seule l'ÉTIQUETTE est exclue — surtout pas le corps de la clause, où vit
    // précisément le `return 'En attente…'` que ce contrôle doit attraper.
    if (ts.isBinaryExpression(cur) && isComparison(cur)) return true;
    if (ts.isCaseClause(cur)) return cur.expression === previous;
  }
  return false;
}

/** Vrai pour `===`, `!==`, `==`, `!=` — les opérateurs qui confrontent sans afficher. */
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
 * Ce nœud a-t-il la forme d'une phrase plutôt que d'un discriminant ?
 *
 * Un gabarit interpolé ou un texte à plusieurs mots est de la prose ; un mot isolé est un
 * identifiant. C'est ce qui sépare `` `SQ### / SH### (pas ${step})` `` — du français affiché
 * en pleine page d'administration — de `value="cards"`.
 */
export function looksLikeProse(node) {
  if (!node) return false;
  if (ts.isTemplateExpression(node) || ts.isNoSubstitutionTemplateLiteral(node)) return true;
  if (ts.isStringLiteral(node)) return /\s/.test(node.text.trim());
  return true;
}

/**
 * La balise qui porte cet attribut est-elle un élément natif du DOM ?
 *
 * JSX tranche sur la casse : `<div>`, `<input>`, `<option>` sont des éléments ; `<Row>`,
 * `<Metric>`, `<Badge>` sont des composants, dont les props peuvent porter de la prose.
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
    // `const LABELS = { DRAFT: t('reviews.draft') }` — évalué à l'import, c'est-à-dire
    // avant l'arrivée du catalogue de la langue (seul l'anglais est embarqué) et jamais
    // réévalué ensuite : la table reste anglaise pour toujours. Même faute qu'un texte en
    // dur, sous une autre forme — la table se convertit en fonction prenant `t`.
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
      const value = literalOf(node.initializer);
      if (value) push(value);
    } else if (
      ts.isPropertyAssignment(node) &&
      (VISIBLE_PROPS.has(node.name.getText(src).replace(/['"]/g, '')) || inLabelTable(node))
    ) {
      // `const FILTERS = [{ value: 'open', label: 'Ouverts' }]` — une table de libellés est
      // du texte d'interface, et c'est là qu'il se cache le plus souvent.
      //
      // Le contexte technique s'applique ici aussi : une variable nommée `monthLabel` fait
      // passer `{ month: 'long', year: 'numeric' }` pour une table de libellés, alors que ce
      // sont les options d'`Intl.DateTimeFormat`.
      const value = literalOf(node.initializer);
      if (value && !inTechnicalContext(node, src)) push(value);
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
    } else if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      (ts.isReturnStatement(node.parent) || ts.isArrowFunction(node.parent)) &&
      inSpeakingPosition(node, src) &&
      !inTechnicalContext(node, src)
    ) {
      // `function statusLabel(u): string { … return 'En attente…' }` — la valeur s'affiche
      // une ligne plus loin, à côté de branches qui appellent bien `t()`.
      push(node.text);
    } else if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.PlusToken &&
      inSpeakingPosition(node, src) &&
      !inTechnicalContext(node, src)
    ) {
      // `'Supprimer ' + n + ' fichiers'` — la même phrase qu'un gabarit, écrite autrement.
      for (const side of [node.left, node.right]) {
        if (ts.isStringLiteral(side) || ts.isNoSubstitutionTemplateLiteral(side)) {
          push(side.text, /^\s|\s$/.test(side.text));
        }
      }
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

/**
 * Répertoires hors périmètre : les catalogues eux-mêmes, et tout ce qui ne s'adresse jamais
 * à un utilisateur — bancs d'essai d'intégration (fixtures, comptes de test, messages
 * d'assertion) et validation de configuration, qui parle à l'exploitant dans les journaux
 * de démarrage, pas à l'écran.
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

/** Scanne l'arborescence et rend les textes en dur, groupés par fichier. */
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

  // Un plafond PAR arborescence : le front reste à zéro, le backend entre avec sa dette.
  // Un total unique laisserait une régression du front se cacher derrière la dette du back.
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

// Importable pour les tests ; exécuté seulement quand on l'appelle directement.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

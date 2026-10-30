// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Generates THIRD-PARTY-NOTICES.md — the attribution of the redistributed third-party components.
 *
 *   node scripts/generate-notices.mjs           # (re)generates the file
 *   node scripts/generate-notices.mjs --check   # writes nothing, fails if it is stale
 *
 * Why: MIT, BSD, ISC and OFL require their copyright notice to accompany every
 * redistribution. ReView redistributes its dependencies (browser bundle, Docker image),
 * so this obligation applies, the project's own licence aside.
 *
 * Only the **production** tree is kept: devDependencies (vite, eslint, vitest…)
 * are never distributed and therefore have no notice to carry.
 *
 * Zero dependencies: npm resolution is replayed by hand over the package-lock.json files.
 *
 * **Limit closed in F-lot8.** Walking the lockfile tree only sees what is
 * *declared*. A package that copies a third party's code into its own build (mermaid
 * bundles js-yaml 4.1.1, Prisma bundles execa, glob, fs-extra…) escaped entirely
 * the generator: that code shipped to production without a notice. `collectVendored` now spots it
 * from the markers bundlers leave (`name@version/node_modules/name/…`) and
 * the output file says so — including when the licence could not be established.
 */
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Scanned packages, in the order they appear in the file. */
export const WORKSPACES = [
  { dir: 'backend', label: 'Backend (Node.js runtime)' },
  { dir: 'frontend', label: 'Frontend (browser bundle)' },
];

const LICENSE_FILE = /^(LICEN[CS]E|COPYING|NOTICE)($|[.\-_])/i;

/**
 * Packages that omit the `license` field of their package.json although their licence file
 * removes any ambiguity. Checked by hand, one by one — otherwise the summary would show a
 * misleading "UNKNOWN".
 */
export const LICENSE_OVERRIDES = {
  // The package's `license` file: "The MIT License (MIT) — Copyright (c) 2019-present
  // Fabio Spampinato, Andrew Maney". Pulled in by mermaid ← @excalidraw/excalidraw.
  'khroma@2.1.0': 'MIT',
};

/**
 * Acceptable licences for a production dependency: permissive, public domain,
 * MPL-2.0 (compatible through its clause 3.3) and the copyleft licences explicitly compatible with
 * AGPLv3 — hence "or later" from GPL-2.0 on, never the "only" variants.
 *
 * Any licence outside this list (proprietary, BSL, Elastic, Commons Clause, SSPL,
 * GPL-2.0-only, or a package with no identifiable licence) makes the script fail: the rule
 * "every dependency must be AGPL-compatible" is thus tooled rather than merely
 * written. A package whose `license` field is missing but whose LICENSE file settles it
 * goes through LICENSE_OVERRIDES, after a manual check.
 */
export const ALLOWED_LICENSES = new Set([
  '0BSD',
  'AGPL-3.0-or-later',
  'Apache-2.0',
  'Artistic-2.0',
  'BlueOak-1.0.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'CC0-1.0',
  'CC-BY-4.0',
  'GPL-2.0-or-later',
  'GPL-3.0-or-later',
  'ISC',
  'LGPL-2.1-or-later',
  'LGPL-3.0-or-later',
  'MIT',
  'MIT-0',
  'MPL-2.0',
  'OFL-1.1',
  'Python-2.0',
  'Unlicense',
  'WTFPL',
  'Zlib',
]);

/**
 * Evaluates an SPDX expression against `ALLOWED_LICENSES`: `MIT`, `(MIT AND Zlib)`,
 * `(MPL-2.0 OR Apache-2.0)`, `Apache-2.0 WITH LLVM-exception`.
 *
 * `OR` leaves the choice — a single acceptable branch is enough. `AND` requires honouring
 * both — all of them must be acceptable. An exception (`WITH`) only lifts
 * obligations: only the licence it accompanies is examined.
 */
export function isAllowedLicense(expression) {
  if (typeof expression !== 'string' || !expression.trim()) return false;
  const tokens = expression.replace(/[()]/g, ' $& ').split(/\s+/).filter(Boolean);
  let pos = 0;

  const parseAtom = () => {
    const token = tokens[pos++];
    if (token === undefined) return false;
    if (token === '(') {
      const inner = parseOr();
      if (tokens[pos] !== ')') return false;
      pos++;
      return inner;
    }
    if (token === ')' || token === 'AND' || token === 'OR') return false;
    if (tokens[pos] === 'WITH') pos += 2; // the named exception adds no obligation
    const id = token.endsWith('+') ? `${token.slice(0, -1)}-or-later` : token;
    return ALLOWED_LICENSES.has(id);
  };
  const parseAnd = () => {
    let value = parseAtom();
    while (tokens[pos] === 'AND') {
      pos++;
      value = parseAtom() && value;
    }
    return value;
  };
  const parseOr = () => {
    let value = parseAnd();
    while (tokens[pos] === 'OR') {
      pos++;
      value = parseAnd() || value;
    }
    return value;
  };

  const allowed = parseOr();
  return pos === tokens.length && allowed;
}

/**
 * Replays npm resolution: from a folder, a package is looked up in the
 * local node_modules, then up through the parents.
 */
export function resolveEntry(packages, from, name) {
  let dir = from;
  for (;;) {
    const key = `${dir ? `${dir}/` : ''}node_modules/${name}`;
    if (packages[key]) return key;
    if (!dir) return null;
    const cut = dir.lastIndexOf('/node_modules/');
    dir = cut < 0 ? '' : dir.slice(0, cut);
  }
}

/**
 * Lockfile keys making up the production tree: we start from the dependencies of the
 * paquet racine et on suit dependencies/optionalDependencies/peerDependencies.
 */
export function productionTree(lock) {
  const packages = lock.packages ?? {};
  const root = packages[''] ?? {};
  const seen = new Set();
  const stack = Object.keys(root.dependencies ?? {})
    .map((name) => resolveEntry(packages, '', name))
    .filter(Boolean);

  while (stack.length) {
    const key = stack.pop();
    if (seen.has(key)) continue;
    seen.add(key);
    const entry = packages[key] ?? {};
    const deps = {
      ...entry.dependencies,
      ...entry.optionalDependencies,
      ...entry.peerDependencies,
    };
    for (const name of Object.keys(deps)) {
      const next = resolveEntry(packages, key, name);
      if (next && !seen.has(next)) stack.push(next);
    }
  }
  return [...seen].sort();
}

/** npm name of a lockfile key (`node_modules/a/node_modules/b` → `b`). */
export function packageName(key) {
  return key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length);
}

/** Readable repository URL, whatever the shape of the `repository` field. */
export function repositoryUrl(pkg) {
  const repo = pkg?.repository;
  const raw = typeof repo === 'string' ? repo : repo?.url;
  if (!raw) return null;
  return raw
    .replace(/^git\+/, '')
    .replace(/\.git$/, '')
    .replace(/^git:\/\//, 'https://')
    .replace(/^github:/, 'https://github.com/');
}

/** Declared licence expression, including the historical `licenses: [...]` form. */
export function declaredLicense(pkg) {
  if (typeof pkg?.license === 'string') return pkg.license;
  if (pkg?.license?.type) return pkg.license.type;
  if (Array.isArray(pkg?.licenses)) return pkg.licenses.map((l) => l.type ?? l).join(' OR ');
  return null;
}

/** Reads the licence text shipped by the package, if it provides one. */
async function readLicenseText(dir) {
  let entries;
  try {
    entries = await readdir(dir);
  } catch {
    return null;
  }
  const names = entries.filter((name) => LICENSE_FILE.test(name)).sort();
  const chunks = [];
  for (const name of names) {
    const full = path.join(dir, name);
    try {
      if (!(await stat(full)).isFile()) continue;
      // Line endings normalised to LF: several packages ship their LICENSE in CRLF
      // (color-name, fluent-ffmpeg, tslib…). Without this normalisation, the output file
      // would contain CRs that git strips on commit (`.gitattributes`: `text eol=lf`), and the
      // freshness comparison of validate.sh could never succeed in CI.
      const text = (await readFile(full, 'utf8')).replace(/\r\n/g, '\n').trim();
      if (text) chunks.push({ name, text });
    } catch {
      /* unreadable: at least keep the SPDX identifier */
    }
  }
  return chunks.length ? chunks : null;
}

/** Collects the attribution metadata of a workspace. */
export async function collectWorkspace(repoRoot, workspace, lock, tree) {
  if (!lock) {
    const lockPath = path.join(repoRoot, workspace.dir, 'package-lock.json');
    lock = JSON.parse(await readFile(lockPath, 'utf8'));
  }
  const seen = new Map();

  for (const key of tree ?? productionTree(lock)) {
    const dir = path.join(repoRoot, workspace.dir, key);
    /*
     * Native binary restricted to one platform: we read nothing from `node_modules`.
     *
     * npm only installs the variant for the current machine — `@esbuild/win32-x64` here,
     * `@esbuild/linux-x64` on the runner. The generator therefore found the `package.json` of
     * one and not of the others, and only wrote the "Source" field for that one: the output
     * file depended on the build OS, and the freshness comparison of `validate.sh` could not
     * succeed on both sides at once. That is what made every CI run fail, over a single line of
     * difference (`@msgpackr-extract/msgpackr-extract-*`).
     *
     * The lockfile, for its part, describes the 53 to 59 variants identically everywhere: name, version
     * and licence are enough for attribution, and the output becomes deterministic again.
     */
    const locked = lock.packages[key] ?? {};
    const platformSpecific = Array.isArray(locked.os) || Array.isArray(locked.cpu);
    let pkg = {};
    if (!platformSpecific) {
      try {
        pkg = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'));
      } catch {
        /* package not installed: we settle for what the lockfile says */
      }
    }
    const name = packageName(key);
    const version = pkg.version ?? locked.version ?? '?';
    const id = `${name}@${version}`;
    if (seen.has(id)) continue;
    seen.set(id, {
      id,
      name,
      version,
      license: declaredLicense(pkg) ?? locked.license ?? LICENSE_OVERRIDES[id] ?? 'UNKNOWN',
      repository: repositoryUrl(pkg),
      // Same reason as above: the licence text only exists on disk for the installed
      // variant. Reading it would make the output platform-dependent.
      texts: platformSpecific ? null : await readLicenseText(dir),
    });
  }
  return [...seen.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/* ------------------------------------------------------------------------------------ *
 * Third-party code copied inside a package ("vendored")
 * ------------------------------------------------------------------------------------ */

/**
 * Licences of internal copies checked by hand, when neither of the two heuristics below
 * settles it. Same contract as `LICENSE_OVERRIDES`: we only record here what we actually read in
 * the repository of the project concerned.
 */
export const VENDORED_LICENSES = {};

/** Files likely to contain bundled code (not the `.map` files, never shipped). */
const SHIPPED_CODE = /\.(m|c)?js$/;

/** Quick pre-cut: no need to decode a file that cites no `node_modules`. */
const NODE_MODULES = Buffer.from('/node_modules/');

/**
 * Bundled-module marker left by esbuild/rollup when the package was built
 * with pnpm: `.pnpm/js-yaml@4.1.1/node_modules/js-yaml/dist/js-yaml.mjs`. The suffix
 * `_peer@x` of peer installations is tolerated. pnpm encodes `@scope/nom` as
 * `@scope+nom` in its store: the two spellings must therefore designate the same package.
 */
const VENDORED_MARKER = /(@?[\w.+-]+)@(\d[\w.+-]*)(?:_[^/]*)?\/node_modules\/((?:@[\w.-]+\/)?[\w.-]+)\//g;

/**
 * `name@version` identifiers of the third-party code copied into a source text.
 *
 * Deliberately restricted to **versioned** markers: a bundler comment without a
 * version (`../node_modules/foo/index.js`) allows neither attributing a licence nor
 * telling a copy apart from a mere cited path. Better not to claim to see it.
 */
export function vendoredIdsFrom(text) {
  const out = new Set();
  for (const [, outer, version, inner] of text.matchAll(VENDORED_MARKER)) {
    if (inner !== outer && inner !== outer.replace('+', '/')) continue;
    out.add(`${inner}@${version}`);
  }
  return out;
}

/** Walks an installed package without descending into its nested `node_modules`. */
async function* shippedFiles(dir) {
  const stack = [dir];
  while (stack.length) {
    let entries;
    const cur = stack.pop();
    try {
      entries = await readdir(cur, { withFileTypes: true });
    } catch {
      continue; // package not installed: nothing to scan
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules') continue;
      const full = path.join(cur, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (SHIPPED_CODE.test(entry.name)) yield full;
    }
  }
}

/**
 * Internal copies found in a workspace's production tree: `id` → host packages
 * hosts. A copy already present in the tree under the same version is ignored — it already has
 * its notice. It is indeed the **version** that counts: the frontend lockfile carries
 * js-yaml 4.3.1 (via eslint, hence never distributed) while mermaid copies 4.1.1.
 */
export async function collectVendored(repoRoot, workspace, lock, tree) {
  const shipped = new Set(tree.map((k) => `${packageName(k)}@${lock.packages[k]?.version ?? '?'}`));
  const found = new Map();
  for (const key of tree) {
    const locked = lock.packages[key] ?? {};
    // Same reason as above: a native binary is only installed for the current
    // platform. The scanner would return a different result under Windows and under Linux.
    if (Array.isArray(locked.os) || Array.isArray(locked.cpu)) continue;
    const host = packageName(key);
    for await (const file of shippedFiles(path.join(repoRoot, workspace.dir, key))) {
      let buffer;
      try {
        buffer = await readFile(file);
      } catch {
        continue;
      }
      if (!buffer.includes(NODE_MODULES)) continue;
      for (const id of vendoredIdsFrom(buffer.toString('latin1'))) {
        if (shipped.has(id) || id === `${host}@${locked.version}`) continue;
        if (!found.has(id)) found.set(id, new Set());
        found.get(id).add(host);
      }
    }
  }
  return found;
}

/** Licence index of both lockfiles, dev included: an internal copy can come from anywhere. */
export function lockLicenseIndex(locks) {
  const byId = new Map();
  const byName = new Map();
  for (const lock of locks) {
    for (const [key, entry] of Object.entries(lock.packages ?? {})) {
      if (!key.includes('node_modules/') || !entry.version || !entry.license) continue;
      const name = packageName(key);
      byId.set(`${name}@${entry.version}`, entry.license);
      if (!byName.has(name)) byName.set(name, new Set());
      byName.get(name).add(entry.license);
    }
  }
  return { byId, byName };
}

/**
 * Licence of an internal copy, and what it rests on — that second piece of information
 * is what makes the report honest: a licence read from *another version* of the same package
 * is a presumption, not a verification.
 */
export function vendoredLicense(id, index) {
  const name = id.slice(0, id.lastIndexOf('@'));
  if (VENDORED_LICENSES[id]) return { license: VENDORED_LICENSES[id], basis: 'verified by hand' };
  if (index.byId.has(id)) return { license: index.byId.get(id), basis: 'same version in a lockfile' };
  const versions = index.byName.get(name);
  if (versions?.size === 1) {
    return { license: [...versions][0], basis: 'other versions of the package, all agreeing' };
  }
  return { license: null, basis: 'not determined' };
}

/** Assembles the sorted list of a workspace's internal copies, licence included. */
export function describeVendored(found, index, workspaceLabel) {
  return [...found.entries()]
    .map(([id, hosts]) => ({
      id,
      workspace: workspaceLabel,
      hosts: [...hosts].sort(),
      ...vendoredLicense(id, index),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** Fences a text without risking breaking the Markdown. */
function fence(text) {
  const ticks = '`'.repeat(Math.max(3, ...(text.match(/`+/g) ?? ['']).map((m) => m.length + 1)));
  return `${ticks}text\n${text}\n${ticks}`;
}

/**
 * Internal copies section. Written to say two things: what the scan found,
 * and what it cannot see. A list that presented itself as exhaustive without being so
 * would be worse than no list at all.
 */
export function renderVendored(vendored) {
  if (!vendored.length) return [];
  const unknown = vendored.filter((v) => !v.license).length;
  return [
    '## Vendored third-party code',
    '',
    'Some packages ship a copy of another project inside their own build output instead of',
    'depending on it. Those copies are redistributed with ReView, but they appear in no',
    'lockfile, so the lists above cannot see them: mermaid inlines js-yaml, Prisma inlines',
    'execa, glob and fs-extra, and none of them was named here before.',
    '',
    'They are recovered from the build markers bundlers leave behind',
    '(`name@version/node_modules/name/…`) and listed for attribution.',
    '',
    '> **This list is a best effort, not a proof of completeness.** Only markers that carry a',
    '> version can be attributed; a copy inlined without one stays invisible to the scan, and',
    '> no verbatim license text is available for these copies since they are not installed as',
    '> packages. Please report anything you find missing.',
    '',
    `${vendored.length} copies, ${unknown} of which with no license established.`,
    '',
    '| Component | Copied inside | License | Determined from |',
    '| --- | --- | --- | --- |',
    ...vendored.map(
      (v) =>
        `| \`${v.id}\` | ${v.hosts.map((h) => `\`${h}\``).join(', ')} (${v.workspace}) |` +
        ` ${v.license ? `\`${v.license}\`` : '**unverified**'} | ${v.basis} |`,
    ),
    '',
  ];
}

/** Rend le fichier de notices complet. */
export function renderNotices(sections, vendored = []) {
  const all = sections.flatMap((s) => s.packages);
  const counts = new Map();
  for (const p of all) counts.set(p.license, (counts.get(p.license) ?? 0) + 1);

  const out = [
    '# Third-Party Notices',
    '',
    'ReView is distributed under the GNU Affero General Public License v3.0 or later',
    '(see [LICENSE](LICENSE)). It redistributes the third-party components listed below —',
    'in the browser bundle, in the Docker images, or both.',
    '',
    'Their licenses require their copyright and permission notices to be preserved, so each',
    'component appears here with the verbatim license text it ships. Only **production**',
    'dependencies are listed: build-time tooling is never redistributed.',
    '',
    '> Generated by `scripts/generate-notices.mjs`. Do not edit by hand — run the script.',
    '',
    '## Summary',
    '',
    '| License | Packages |',
    '| --- | --- |',
    ...[...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([license, n]) => `| ${license} | ${n} |`),
    `| **Total** | **${all.length}** |`,
    '',
    'Runtime services that ReView talks to over the network (PostgreSQL, Redis, MinIO,',
    'ClamAV, Prometheus, Grafana, nginx) run as separate programs in their own containers.',
    'They are aggregated, not linked, and keep their own licenses. Likewise, the backend',
    'image bundles FFmpeg (GPL-2.0-or-later, Debian build) and — only when built with',
    '`INSTALL_USD_TOOLS=1` — Blender (GPL-2.0-or-later): anyone redistributing that image',
    'must pass on the corresponding source offer for those programs.',
    '',
  ];

  for (const section of sections) {
    out.push(`## ${section.label}`, '', `${section.packages.length} packages.`, '');
    for (const pkg of section.packages) {
      out.push(`### ${pkg.id}`, '');
      out.push(`- License: \`${pkg.license}\``);
      if (pkg.repository) out.push(`- Source: ${pkg.repository}`);
      out.push('');
      if (pkg.texts) {
        for (const chunk of pkg.texts) out.push(fence(chunk.text), '');
      } else {
        out.push(
          `_No license file shipped in the package; the \`${pkg.license}\` declaration in its` +
            ' `package.json` governs._',
          '',
        );
      }
    }
  }
  out.push(...renderVendored(vendored));
  return `${out.join('\n').trimEnd()}\n`;
}

/** Compares while ignoring line endings (the repository is cloned under Windows as well as Linux). */
const normalize = (text) => text.replace(/\r\n/g, '\n');

async function main() {
  const check = process.argv.includes('--check');
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const target = path.join(repoRoot, 'THIRD-PARTY-NOTICES.md');

  const sections = [];
  const locks = [];
  const trees = [];
  for (const workspace of WORKSPACES) {
    const lock = JSON.parse(await readFile(path.join(repoRoot, workspace.dir, 'package-lock.json'), 'utf8'));
    const tree = productionTree(lock);
    locks.push(lock);
    trees.push(tree);
    sections.push({
      label: workspace.label,
      packages: await collectWorkspace(repoRoot, workspace, lock, tree),
    });
  }

  // Third-party code copied into a package: invisible from the lockfile, hence from the rest of this script.
  const index = lockLicenseIndex(locks);
  const vendored = [];
  for (const [i, workspace] of WORKSPACES.entries()) {
    const found = await collectVendored(repoRoot, workspace, locks[i], trees[i]);
    vendored.push(...describeVendored(found, index, workspace.dir));
  }
  vendored.sort((a, b) => a.id.localeCompare(b.id) || a.workspace.localeCompare(b.workspace));

  // Compatibility guardrail: a dependency under a licence not compatible with the AGPL must
  // not merely appear in the notices, it must stop the validation. An
  // internal copy whose licence is established is subject to it in the same way; one whose
  // licence remains undetermined is reported in the file, not turned into a block
  // on a presumption.
  const rejected = [
    ...sections.flatMap((section) => section.packages),
    ...vendored.filter((v) => v.license),
  ].filter((pkg) => !isAllowedLicense(pkg.license));
  if (rejected.length) {
    console.error(`✗ ${rejected.length} dépendance(s) sous licence non compatible AGPL-3.0 :`);
    for (const pkg of rejected) console.error(`  ${pkg.id} — ${pkg.license}`);
    console.error('  → remplacer la dépendance ; si la licence est mal déclarée, vérifier son fichier');
    console.error('    LICENSE puis compléter LICENSE_OVERRIDES ou ALLOWED_LICENSES.');
    process.exit(1);
  }

  const content = renderNotices(sections, vendored);
  const unverified = vendored.filter((v) => !v.license).length;
  if (unverified) {
    console.warn(
      `! ${unverified} copie(s) interne(s) sans licence établie — listées « unverified » dans` +
        ' THIRD-PARTY-NOTICES.md ; les vérifier une à une et compléter VENDORED_LICENSES.',
    );
  }

  if (check) {
    let current = '';
    try {
      current = await readFile(target, 'utf8');
    } catch {
      console.error('✗ THIRD-PARTY-NOTICES.md est absent → node scripts/generate-notices.mjs');
      process.exit(1);
    }
    if (normalize(current) !== normalize(content)) {
      console.error('✗ THIRD-PARTY-NOTICES.md est périmé → node scripts/generate-notices.mjs');
      process.exit(1);
    }
    console.log(
      `✓ THIRD-PARTY-NOTICES.md à jour (${sections.reduce((n, s) => n + s.packages.length, 0)} paquets,` +
        ` ${vendored.length} copies internes)`,
    );
    return;
  }

  await writeFile(target, content);
  console.log(
    `✓ THIRD-PARTY-NOTICES.md écrit — ${sections.map((s) => `${s.packages.length} ${s.label.split(' ')[0].toLowerCase()}`).join(', ')},` +
      ` ${vendored.length} copies internes`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}

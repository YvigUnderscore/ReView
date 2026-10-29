// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Invariants of startup, containers and HTTP transport.
 *
 * Ces fichiers (start.sh, compose, nginx, .env.example) ne passent par aucun compilateur :
 * a regression there is invisible until the day of deployment. The checks below
 * lock down what has actually bitten — the `db push --accept-data-loss` fallback that
 * could empty the production database, the 27 environment variables that did not reach
 * the container, the absence of log rotation and of HTTP compression.
 *
 * Deliberately textual: the aim is not to reimplement a YAML parser, but
 * to prevent a few lines from silently disappearing.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');

/** The service blocks of docker-compose.yml, indexed by name. */
export function serviceBlocks(yaml) {
  const lines = yaml.split(/\r?\n/);
  const start = lines.findIndex((l) => l === 'services:');
  const blocks = new Map();
  let current = null;
  for (const line of lines.slice(start + 1)) {
    const header = /^ {2}([a-z0-9_-]+):\s*$/.exec(line);
    if (header) {
      current = header[1];
      blocks.set(current, []);
      continue;
    }
    // An unindented line closes the `services:` section (e.g. `volumes:`).
    if (line.trim() !== '' && !line.startsWith('  ')) break;
    if (current) blocks.get(current).push(line);
  }
  return new Map([...blocks].map(([name, body]) => [name, body.join('\n')]));
}

/** The variables declared by the Zod schema of backend/src/config/env.ts. */
export function schemaVariables(source) {
  return [...source.matchAll(/^ {2}([A-Z][A-Z0-9_]*):\s*z\b/gm)].map((m) => m[1]);
}

/** The variables an operator can set in .env (active or commented out). */
export function documentedVariables(sample) {
  return new Set([...sample.matchAll(/^(?:# ?)?([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]));
}

/**
 * The port mappings published by a service (contents of its `ports:` key).
 *
 * We do not sweep the whole block: `extra_hosts:` has the same list shape, and confusing the
 * two would make "host.docker.internal:host-gateway" pass for an open port.
 */
export function publishedPorts(body) {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((l) => l === '    ports:');
  if (start === -1) return [];
  const mappings = [];
  for (const line of lines.slice(start + 1)) {
    const entry = /^ {6}- "?([^"]+?)"?$/.exec(line);
    if (!entry) break;
    mappings.push(entry[1]);
  }
  return mappings;
}

/**
 * The `location …` blocks of an nginx configuration, indexed by their header.
 *
 * A brace counter rather than a regular expression: a `location` contains blocks
 * nested (`if (…) { … }`), and stopping at the first closing brace would make it seem
 * that a directive placed after it belongs to the server.
 */
export function locationBlocks(conf) {
  const blocks = new Map();
  const re = /^(?!\s*#)\s*location\s+([^{]+?)\s*\{/gm;
  let m;
  while ((m = re.exec(conf)) !== null) {
    let depth = 1;
    let i = re.lastIndex;
    while (i < conf.length && depth > 0) {
      if (conf[i] === '{') depth += 1;
      else if (conf[i] === '}') depth -= 1;
      i += 1;
    }
    // Two servers in the same file can carry the SAME location — `/` redirecting in
    // plain text to HTTPS and `/` serving the SPA. Without a distinct key, the second overwrote the
    // first: the request-body check only saw one block out of two, and
    // `outsideLocations` let the forgotten body pass as server configuration.
    // The first occurrence keeps the bare key (the `.get('/api/')` calls stay true).
    let key = m[1];
    for (let n = 2; blocks.has(key); n += 1) key = `${m[1]} #${n}`;
    blocks.set(key, conf.slice(re.lastIndex, i - 1));
  }
  return blocks;
}

/** The private configuration of their `location` bodies: what applies to the whole server. */
export function outsideLocations(conf) {
  let rest = conf;
  for (const body of locationBlocks(conf).values()) rest = rest.replace(body, '\n');
  return rest;
}

describe('backend/start.sh', () => {
  const startSh = read('backend', 'start.sh');
  // The script's comments describe the removed anti-pattern, and an error message
  // quotes it: it is the EXECUTED code that is inspected, not the prose.
  const commands = startSh
    .split(/\r?\n/)
    .filter((l) => !/^\s*#/.test(l) && !/^\s*echo /.test(l))
    .join('\n');

  it("n'aligne jamais la base au prix des données", () => {
    expect(commands).not.toMatch(/--accept-data-loss/);
  });

  it("ne masque pas la cause d'un échec de migration, et n'y enchaîne aucun repli", () => {
    expect(commands).not.toMatch(/migrate deploy[^\n]*2>\s*\/dev\/null/);
    expect(commands).not.toMatch(/migrate deploy[^\n]*\|\|/);
  });

  it('joue les migrations versionnées et sort en erreur si elles échouent', () => {
    expect(startSh).toContain('npx prisma migrate deploy');
    expect(startSh).toMatch(/if ! npx prisma migrate deploy; then[\s\S]*exit 1/);
  });

  it('réserve `db push` à un choix explicite, refusé en production', () => {
    expect(startSh).toMatch(/PRISMA_DB_PUSH/);
    expect(startSh).toMatch(/NODE_ENV.*=\s*"?production"?/);
    // `db push` without the destructive option: it refuses by itself to lose data.
    expect(startSh).toMatch(/npx prisma db push\s*$/m);
  });

  it('échoue au premier faux pas', () => {
    expect(startSh).toMatch(/^set -e$/m);
  });
});

describe('docker-compose.yml', () => {
  const compose = read('docker-compose.yml');
  const services = serviceBlocks(compose);

  it('déclare les neuf services de la pile', () => {
    expect([...services.keys()]).toEqual([
      'postgres',
      'minio',
      'redis',
      'backend',
      'worker',
      'prometheus',
      'grafana',
      'clamav',
      'frontend',
    ]);
  });

  it('borne les journaux de TOUS les services (pas de json-file sans rotation)', () => {
    for (const [name, body] of services) {
      expect(body, `service ${name}`).toMatch(/^ {4}logging:/m);
    }
    expect(compose).toMatch(/max-size: "10m"/);
    expect(compose).toMatch(/max-file: "5"/);
  });

  it('charge .env dans les deux conteneurs applicatifs', () => {
    for (const name of ['backend', 'worker']) {
      expect(services.get(name), `service ${name}`).toMatch(/^ {4}env_file:\n {6}- path: \.env/m);
    }
  });

  it('garde la topologie réseau en surcharge explicite (elle prime sur .env)', () => {
    for (const name of ['backend', 'worker']) {
      const body = services.get(name);
      expect(body).toMatch(/DATABASE_URL: postgresql:\/\/.*@postgres:5432/);
      expect(body).toMatch(/S3_ENDPOINT: http:\/\/minio:9000/);
      expect(body).toMatch(/REDIS_URL: redis:\/\/:\$\{REDIS_PASSWORD:-[^}]+\}@redis:6379/);
    }
  });

  it('protège Redis par un mot de passe, obligatoire en production', () => {
    expect(services.get('redis')).toMatch(/--requirepass "\$\$REDIS_PASSWORD"/);
    const prod = read('docker-compose.prod.yml');
    expect(prod).toMatch(/REDIS_PASSWORD: \$\{REDIS_PASSWORD:\?/);
    expect(prod).toMatch(/REDIS_URL: redis:\/\/:\$\{REDIS_PASSWORD:\?[^}]+\}@redis:6379/);
  });

  it('ne retombe jamais sur minioadmin (échec explicite si absent)', () => {
    expect(compose).not.toMatch(/:-minioadmin/);
    expect(compose).toMatch(/MINIO_ROOT_PASSWORD:\?/);
  });

  it('plafonne la mémoire du backend, du worker et de Postgres', () => {
    for (const name of ['backend', 'worker', 'postgres']) {
      expect(services.get(name), `service ${name}`).toMatch(/^ {4}mem_limit:/m);
    }
  });

  it('ne tire MinIO d’aucun dépôt retiré par son éditeur', () => {
    // `minio/minio` and `minio/mc` are no longer pulled from Docker Hub (2026-10): an image in
    // cache hides the failure on a workstation, a fresh install or a `docker compose pull`
    // (scripts/update.sh) fails. The `mc` client comes from the server image.
    const RETIRED = /(?:^|[\s"'=])(?:docker\.io\/)?minio\/(?:minio|mc)(?=[:\s"']|$)/m;
    const files = [
      'docker-compose.yml',
      ...readdirSync(ROOT)
        .filter((f) => /^docker-compose\..+\.ya?ml$/.test(f))
        .filter((f) => f !== 'docker-compose.yml'),
      ...readdirSync(join(ROOT, '.github', 'workflows')).map((f) => `.github/workflows/${f}`),
      ...readdirSync(join(ROOT, 'scripts'))
        .filter((f) => f.endsWith('.sh'))
        .map((f) => `scripts/${f}`),
      'ops/agent.sh',
      'ops/Dockerfile',
    ];
    for (const file of files) {
      const code = read(file)
        .split(/\r?\n/)
        .filter((line) => !line.trim().startsWith('#'))
        .join('\n');
      expect(code, file).not.toMatch(RETIRED);
    }
  });

  it("n'épingle aucune image sur un tag mouvant", () => {
    const images = [...compose.matchAll(/^ {4}image: (\S+)$/gm)].map((m) => m[1]);
    expect(images.length).toBeGreaterThan(0);
    for (const image of images) {
      expect(image, image).not.toMatch(/:latest$/);
      expect(image, image).toMatch(/:/);
    }
  });

  it('sonde le backend en IPv4 sur une route configurable', () => {
    const body = services.get('backend');
    expect(body).toContain('http://127.0.0.1:3000');
    expect(body).toContain("process.env.HEALTH_PATH || '/health'");
  });

  it('borne explicitement le pool Prisma des deux process qui se connectent', () => {
    // Without `connection_limit`, Prisma sizes its pool to "physical cores × 2 + 1",
    // PER PROCESS. Measured on the development host (32 logical cores): 20 concurrent
    // requests opened 20 connections on a bare URL, 10 on the bounded URL. At 32
    // physical cores, backend + worker would ask for 130 connections for the 100 of
    // the postgres image, and the second process to start loops on "too many clients".
    for (const name of ['backend', 'worker']) {
      const body = services.get(name);
      expect(body, `service ${name}`).toMatch(/DATABASE_URL: [^\n]*[?&]connection_limit=/);
      expect(body, `service ${name}`).toMatch(/DATABASE_URL: [^\n]*[?&]pool_timeout=/);
    }
  });

  it("charge les règles d'alerte de Prometheus (sinon aucune n'est jamais évaluée)", () => {
    // `rule_files` is a deliberately tolerant glob: without the mount, Prometheus
    // starts without a word with ZERO rules. Verified by running: 0 groups without the
    // mount, 4 groups (10 rules) with it.
    const prometheusConf = read('monitoring', 'prometheus.yml');
    const ruleGlob = /^ {2}- (\/\S+)\/\*\.yml$/m.exec(prometheusConf);
    expect(ruleGlob, 'prometheus.yml doit déclarer un rule_files').not.toBeNull();
    const mounted = new RegExp(`- \\./monitoring/rules:${ruleGlob[1]}:ro`);
    expect(services.get('prometheus')).toMatch(mounted);
    expect(
      readdirSync(join(ROOT, 'monitoring', 'rules')).filter((f) => f.endsWith('.yml')).length,
    ).toBeGreaterThan(0);
  });

  it("ne publie aucun port sur toutes les interfaces sans qu'on l'ait demandé", () => {
    // The backend was the only service published without an interface prefix: the API, in plain
    // text and without TLS, was offered to the whole studio network — login tokens included — and
    // `X-Forwarded-For` became forgeable there, so every per-IP rate limiter was bypassable.
    // The frontend stays on 0.0.0.0: it is the SPA, and it is the service we publish.
    const exposed = [...services].flatMap(([name, body]) =>
      publishedPorts(body).map((mapping) => [name, mapping]),
    );
    const unbound = exposed.filter(
      ([name, mapping]) => name !== 'frontend' && !/^\$\{[A-Z_]+:-127\.0\.0\.1\}:/.test(mapping),
    );
    expect(unbound).toEqual([]);
  });
});

/**
 * `app.set('trust proxy', …)` — textual check, by design.
 *
 * The value itself is covered by backend/src/config/env.test.ts (null default, bounds,
 * and the `req.ip` observed on a real Express server). What is missing is the LINK: that
 * app.ts does pass the variable and not a literal. No unit test mounts `createApp`
 * — it arms the Redis transport — so this link is only verifiable here.
 */
describe('backend/src/app.ts — confiance accordée à X-Forwarded-For', () => {
  const app = read('backend', 'src', 'app.ts');

  it('lit le nombre de proxys de confiance dans la configuration', () => {
    expect(app).toMatch(/app\.set\('trust proxy', env\.TRUST_PROXY\)/);
  });

  it('ne fait jamais confiance en dur', () => {
    // `trust proxy` set to a hard-coded value makes `req.ip` — key of all the limiters and
    // address of the audit log — a header supplied by the caller.
    expect(app).not.toMatch(/app\.set\('trust proxy',\s*(?:1|true|'[^']*')\)/);
  });
});

describe('.env.example', () => {
  const sample = read('.env.example');
  const documented = documentedVariables(sample);
  const variables = schemaVariables(read('backend', 'src', 'config', 'env.ts'));

  // Set by docker-compose from the internal topology: filling them in .env
  // would have no effect. They remain explained in a comment, not as an adjustable line.
  const IMPOSED_BY_COMPOSE = new Set([
    'S3_ENDPOINT',
    'S3_ACCESS_KEY',
    'S3_SECRET_KEY',
    'S3_FORCE_PATH_STYLE',
  ]);

  it('connaît le schéma complet du backend', () => {
    expect(variables.length).toBeGreaterThanOrEqual(43);
  });

  it('documente chaque variable du schéma', () => {
    const missing = variables.filter(
      (name) => !documented.has(name) && !new RegExp(`\\b${name}\\b`).test(sample),
    );
    expect(missing).toEqual([]);
  });

  it('rend réglable tout ce qui ne dépend pas de la topologie du compose', () => {
    const missing = variables.filter((n) => !IMPOSED_BY_COMPOSE.has(n) && !documented.has(n));
    expect(missing).toEqual([]);
  });

  it('laisse les options facultatives commentées plutôt que vides', () => {
    // An empty variable is not an absent variable: `SMTP_HOST=` would make the
    // backend believe a sending server is configured.
    for (const name of ['SMTP_HOST', 'SMTP_USER', 'APP_URL', 'APP_ENCRYPTION_KEY', 'LOG_LEVEL']) {
      expect(sample, name).not.toMatch(new RegExp(`^${name}=`, 'm'));
      expect(sample, name).toMatch(new RegExp(`^# ${name}=`, 'm'));
    }
  });
});

describe('nginx', () => {
  const configs = {
    'frontend/nginx.conf': read('frontend', 'nginx.conf'),
    'nginx/nginx.conf': read('nginx', 'nginx.conf'),
  };

  for (const [name, conf] of Object.entries(configs)) {
    it(`compresse les réponses textuelles (${name})`, () => {
      expect(conf).toMatch(/^gzip on;/m);
      expect(conf).toMatch(/^gzip_min_length \d+;/m);
      // The default `gzip_proxied off` would compress no proxied response.
      expect(conf).toMatch(/^gzip_proxied /m);
      for (const type of ['application/javascript', 'text/css', 'application/json', 'image/svg+xml']) {
        expect(conf, type).toContain(type);
      }
      // Already compressed: gzipping them would cost CPU for nothing.
      expect(conf).not.toContain('font/woff2');
    });

    it(`fige les assets hachés par Vite (${name})`, () => {
      // The block filters on the EXTENSION, not the prefix: `location ^~ /assets/` also captured
      // the application route `/assets/:id` (asset sheet) and ended it in a 404.
      expect(conf).toMatch(/location ~ \^\/assets\/\.\+\\.\(/);
      expect(conf).not.toMatch(/location \^~ \/assets\/ \{/);
      expect(conf).toMatch(/expires 1y;/);
      expect(conf).toMatch(/add_header Cache-Control "public, immutable" always;/);
    });

    it(`ne masque aucune route de l'application par un répertoire du build (${name})`, () => {
      // The production front proxies everything: it has no `try_files`, so only the
      // directory resolution assertions concern the container configuration.
      if (!conf.includes('try_files')) return;
      // `try_files $uri $uri/ /index.html` let the DIRECTORY win over the route: `/docs`
      // (materialised by the documentation prebuild) went off as an index redirect —
      // absolute, rebuilt on the internal port, so the public port was lost — then a 403.
      // Every doc URL typed, shared, bookmarked or reloaded was dead.
      expect(conf).not.toMatch(/try_files \$uri \$uri\/ \/index\.html/);
      expect(conf).toMatch(/try_files \$uri \/index\.html;/);
      expect(conf).toMatch(/absolute_redirect off;/);
      expect(conf).toMatch(/port_in_redirect off;/);
    });
  }

  it('ne cache jamais index.html (il pointe vers les assets hachés)', () => {
    const conf = configs['frontend/nginx.conf'];
    expect(conf).toMatch(/location = \/index\.html \{[\s\S]*?Cache-Control "no-cache"/);
  });

  for (const [name, conf] of Object.entries(configs)) {
    it(`borne le corps des requêtes partout où nginx le met sur disque (${name})`, () => {
      // "No limit" at the `server` level was inherited by every `location`. Yet only
      // the one streaming to MinIO sets `proxy_request_buffering off`: elsewhere, nginx writes
      // the ENTIRE body to a temporary file (the container's writable layer,
      // the data volumes' disk) before opening the connection to the backend. Twenty
      // anonymous trickle-fed POSTs filled the disk without any account,
      // and `express.json({ limit: '2mb' })` never had a say.
      expect(outsideLocations(conf)).toMatch(/^\s*client_max_body_size \d+[kKmMgG];$/m);
      for (const [header, body] of locationBlocks(conf)) {
        if (!/client_max_body_size\s+0;/.test(body)) continue;
        expect(body, `location ${header}`).toMatch(/proxy_request_buffering off;/);
      }
    });

    it(`n'ouvre pas le WebSocket à tout l'internet dans la CSP (${name})`, () => {
      // A bare scheme (`ws:`/`wss:`) in a source list allows EVERY host on that scheme:
      // the policy refused `fetch('https://evil.example')` but let through
      // `new WebSocket('wss://evil.example')` — les jetons vivent en localStorage. Socket.io
      // connects to the origin, and `'self'` already covers ws/wss of the same origin (CSP 3).
      for (const directive of conf.matchAll(/connect-src ([^;"]+)/g)) {
        expect(directive[1].split(/\s+/), directive[0]).not.toContain('ws:');
        expect(directive[1].split(/\s+/), directive[0]).not.toContain('wss:');
      }
    });
  }

  it('laisse à /api/ le temps de répondre, des deux côtés du proxy', () => {
    // The frontend container is the real entry point of the docker-only stack: what
    // is missing here is missing nowhere else. Without these timeouts, nginx's 60 s default
    // cut the response with a 504 while Node carried on its work to the end —
    // request paid in full, then thrown away, and the user reloads on top of it.
    for (const [name, conf] of Object.entries(configs)) {
      const api = locationBlocks(conf).get('/api/');
      expect(api, `${name} : bloc /api/`).toBeDefined();
      expect(api, name).toMatch(/proxy_read_timeout 300s;/);
      expect(api, name).toMatch(/proxy_send_timeout 300s;/);
      // The backend deduces the original scheme from it: both configurations must say so.
      expect(api, name).toMatch(/proxy_set_header X-Forwarded-Proto \$scheme;/);
    }
  });

  it("n'annonce une bascule de protocole que lorsque le client en demande une", () => {
    // `Connection 'upgrade'` hard-coded on /api/ announced a protocol change on
    // every ordinary request. The correct form is a `map $http_upgrade` table.
    const conf = configs['frontend/nginx.conf'];
    expect(conf).toMatch(/map \$http_upgrade \$connection_upgrade \{/);
    expect(conf).not.toMatch(/proxy_set_header Connection ['"]upgrade['"];/);
  });
});

/**
 * Production overlay: the TLS front is the ONLY exposed service.
 *
 * What is missing here is missing nowhere else — a cache without a volume writes to the
 * data volumes' disk, and a stuck nginx without a probe stays "running".
 */
describe('docker-compose.prod.yml — frontal TLS', () => {
  const prod = read('docker-compose.prod.yml');
  const conf = read('nginx', 'nginx.conf');

  it('donne un volume au cache déclaré par proxy_cache_path', () => {
    // 2 GB of permanent write rotation landed in the container's writable
    // layer, that is /var/lib/docker — the filesystem of pgdata and
    // miniodata — and started again from zero on each `scripts/update.sh`.
    const cachePath = /proxy_cache_path\s+(\S+)/.exec(conf);
    expect(cachePath, 'nginx.conf doit déclarer un proxy_cache_path').not.toBeNull();
    const parent = cachePath[1].split('/').slice(0, -1).join('/');
    const mounted = [...prod.matchAll(/^ {6}- \S+?:(\S+?)(?::ro)?$/gm)].map((m) => m[1]);
    expect(mounted, `aucun volume monte sur ${parent}`).toContain(parent);
    expect(prod).toMatch(/^volumes:\n {2}nginx_cache:$/m);
  });

  it('sonde le frontal sur un chemin qui ne traverse aucun amont', () => {
    const probe = /wget[^\n]*http:\/\/127\.0\.0\.1(\/\S*?)"/.exec(prod);
    expect(probe, 'le service nginx doit porter un healthcheck wget').not.toBeNull();
    // The probe must target a `location` served by nginx itself: targeting `/` would make
    // the health of the front depend on that of the backend.
    expect([...locationBlocks(conf).keys()]).toContain(`= ${probe[1]}`);
    expect(locationBlocks(conf).get(`= ${probe[1]}`)).toMatch(/return 200/);
  });

  it('ne laisse pas un `return` de niveau serveur court-circuiter la sonde', () => {
    // Observed: a `return 301` set at the `server` level runs in the
    // rewrite phase, BEFORE the location is chosen — the probe went out as a 301 and the
    // healthcheck followed the redirect to a TLS failure.
    expect(outsideLocations(conf)).not.toMatch(/^\s*return 301 /m);
    expect(conf).toMatch(/location \/ \{\n\s*return 301 https:\/\/\$host\$request_uri;/);
  });

  it("n'expose la sonde qu'à la boucle locale", () => {
    // `allow`/`deny` would have no effect: they are evaluated after the rewrite phase, where
    // `return` has already answered (observed: 200 from another address).
    const healthz = locationBlocks(conf).get('= /healthz');
    expect(healthz).toMatch(/if \(\$remote_addr !~/);
    expect(healthz).not.toMatch(/allow /);
  });
});

/**
 * Backend runtime image — INFRA-09.
 *
 * Measured on the built image: uid 0 → uid 1000, six development binaries
 * (vitest, eslint, tsc, tsx, prettier) → zero, all the .ts sources → zero,
 * 446,2 Mo → 350,6 Mo.
 */
describe('backend/Dockerfile — image d’exécution', () => {
  const dockerfile = read('backend', 'Dockerfile');
  const stages = dockerfile.split(/^FROM /m).slice(1);
  const runtime = stages[stages.length - 1];

  it('sépare construction et exécution', () => {
    expect(stages.length).toBe(2);
    expect(stages[0]).toMatch(/^node:\d+-slim AS build/);
  });

  it('installe un arbre reproductible, sans devDependencies à l’exécution', () => {
    // `npm install` rewrites the tree: two images built on two dates do not run the
    // same code. And the devDependencies are tsx and the TypeScript compiler in
    // the image that processes files uploaded by users.
    expect(dockerfile).not.toMatch(/^RUN npm install$/m);
    expect(stages[0]).toMatch(/npm ci/);
    expect(runtime).toMatch(/npm ci --omit=dev/);
  });

  it('n’embarque pas les sources dans l’image finale', () => {
    expect(runtime).not.toMatch(/^COPY \. \.$/m);
    expect(runtime).toMatch(/^COPY --from=build \/app\/dist \.\/dist$/m);
    // Worker resources resolved at runtime under src/: tsc does not copy them.
    for (const asset of ['src/workers/usd/*.py', 'src/workers/ocio/*.py']) {
      expect(runtime, asset).toContain(`COPY ${asset}`);
    }
  });

  it('abandonne les droits de root avant de lancer l’application', () => {
    const user = runtime.indexOf('\nUSER node');
    const cmd = runtime.indexOf('\nCMD ');
    expect(user, 'USER node absent').toBeGreaterThan(-1);
    expect(user).toBeLessThan(cmd);
  });
});

describe('backend — le CLI Prisma est une dépendance d’exécution', () => {
  const pkg = JSON.parse(read('backend', 'package.json'));
  const startSh = read('backend', 'start.sh');

  it('déclare prisma en dependencies, puisque start.sh l’invoque à chaque démarrage', () => {
    // As a devDependency, `npm ci --omit=dev` would prune it and `migrate deploy` would fail at the
    // first start of the container.
    expect(Object.keys(pkg.dependencies)).toContain('prisma');
    expect(Object.keys(pkg.devDependencies)).not.toContain('prisma');
    expect(startSh).toContain('npx prisma migrate deploy');
  });

  it('ne régénère pas le client Prisma à chaque démarrage', () => {
    // Ten seconds or so at each resumption of `restart: always` — and a clear failure
    // since the container runs as uid 1000: node_modules belongs to root.
    expect(startSh).toMatch(/if \[ -d node_modules\/\.prisma\/client \]; then/);
  });

  it('livre un seed exécutable sans tsx, que l’image ne contient plus', () => {
    // `docker compose exec backend npm run seed` is documented (first-run.md): it must
    // keep working although tsx has left the image.
    expect(pkg.scripts.seed).toBe('node dist/seed.js');
    expect(pkg.scripts.build).toContain('build:seed');
  });
});

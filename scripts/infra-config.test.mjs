// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Invariants du démarrage, des conteneurs et du transport HTTP.
 *
 * Ces fichiers (start.sh, compose, nginx, .env.example) ne passent par aucun compilateur :
 * une régression y est invisible jusqu'au jour du déploiement. Les contrôles ci-dessous
 * verrouillent ce qui a réellement mordu — le repli `db push --accept-data-loss` qui
 * pouvait vider la base de production, les 27 variables d'environnement qui n'atteignaient
 * pas le conteneur, l'absence de rotation des journaux et de compression HTTP.
 *
 * Volontairement textuels : le but n'est pas de réimplémenter un analyseur YAML, mais
 * d'empêcher la disparition silencieuse de quelques lignes.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');

/** Les blocs de service de docker-compose.yml, indexés par nom. */
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
    // Une ligne non indentée referme la section `services:` (ex. `volumes:`).
    if (line.trim() !== '' && !line.startsWith('  ')) break;
    if (current) blocks.get(current).push(line);
  }
  return new Map([...blocks].map(([name, body]) => [name, body.join('\n')]));
}

/** Les variables déclarées par le schéma Zod de backend/src/config/env.ts. */
export function schemaVariables(source) {
  return [...source.matchAll(/^ {2}([A-Z][A-Z0-9_]*):\s*z\b/gm)].map((m) => m[1]);
}

/** Les variables qu'un opérateur peut poser dans .env (actives ou commentées). */
export function documentedVariables(sample) {
  return new Set([...sample.matchAll(/^(?:# ?)?([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]));
}

/**
 * Les correspondances de ports publiées par un service (contenu de sa clé `ports:`).
 *
 * On ne balaie pas tout le bloc : `extra_hosts:` a la même forme de liste, et confondre les
 * deux ferait passer « host.docker.internal:host-gateway » pour un port ouvert.
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
 * Les blocs `location …` d'une configuration nginx, indexés par leur en-tête.
 *
 * Compteur d'accolades plutôt qu'expression régulière : une `location` contient des blocs
 * imbriqués (`if (…) { … }`), et s'arrêter à la première accolade fermante ferait croire
 * qu'une directive posée après appartient au serveur.
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
    // Deux serveurs du même fichier peuvent porter la MÊME location — `/` qui redirige en
    // clair vers HTTPS et `/` qui sert la SPA. Sans clé distincte, la seconde écrasait la
    // première : le contrôle du corps des requêtes ne voyait plus qu'un bloc sur deux, et
    // `outsideLocations` laissait le corps oublié passer pour de la configuration de
    // serveur. La première occurrence garde la clé nue (les `.get('/api/')` restent vrais).
    let key = m[1];
    for (let n = 2; blocks.has(key); n += 1) key = `${m[1]} #${n}`;
    blocks.set(key, conf.slice(re.lastIndex, i - 1));
  }
  return blocks;
}

/** La configuration privée du corps de ses `location` : ce qui vaut pour tout le serveur. */
export function outsideLocations(conf) {
  let rest = conf;
  for (const body of locationBlocks(conf).values()) rest = rest.replace(body, '\n');
  return rest;
}

describe('backend/start.sh', () => {
  const startSh = read('backend', 'start.sh');
  // Les commentaires du script décrivent l'anti-patron supprimé, et un message d'erreur le
  // cite : c'est le CODE exécuté qu'on inspecte, pas la prose.
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
    // `db push` sans l'option destructive : il refuse de lui-même de perdre des données.
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
      expect(body).toMatch(/REDIS_URL: redis:\/\/redis:6379/);
    }
  });

  it('plafonne la mémoire du backend, du worker et de Postgres', () => {
    for (const name of ['backend', 'worker', 'postgres']) {
      expect(services.get(name), `service ${name}`).toMatch(/^ {4}mem_limit:/m);
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
    // Sans `connection_limit`, Prisma dimensionne son pool à « cœurs physiques × 2 + 1 »,
    // PAR PROCESS. Mesuré sur l'hôte de développement (32 cœurs logiques) : 20 requêtes
    // concurrentes ont ouvert 20 connexions sur une URL nue, 10 sur l'URL bornée. À 32
    // cœurs physiques, backend + worker demanderaient 130 connexions pour les 100 de
    // l'image postgres, et le second process à démarrer boucle sur « too many clients ».
    for (const name of ['backend', 'worker']) {
      const body = services.get(name);
      expect(body, `service ${name}`).toMatch(/DATABASE_URL: [^\n]*[?&]connection_limit=/);
      expect(body, `service ${name}`).toMatch(/DATABASE_URL: [^\n]*[?&]pool_timeout=/);
    }
  });

  it("charge les règles d'alerte de Prometheus (sinon aucune n'est jamais évaluée)", () => {
    // `rule_files` est une glob volontairement tolérante : sans le montage, Prometheus
    // démarre sans un mot avec ZÉRO règle. Vérifié par exécution : 0 groupe sans le
    // montage, 4 groupes (10 règles) avec.
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
    // Le backend était le seul service publié sans préfixe d'interface : l'API, en clair et
    // sans TLS, était offerte à tout le réseau du studio — jetons de connexion compris — et
    // `X-Forwarded-For` y devenait forgeable, donc tous les limiteurs par IP contournables.
    // Le frontend reste sur 0.0.0.0 : c'est la SPA, et c'est le service qu'on publie.
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
 * `app.set('trust proxy', …)` — vérification textuelle, à dessein.
 *
 * La valeur elle-même est couverte par backend/src/config/env.test.ts (défaut nul, bornes,
 * et le `req.ip` observé sur un vrai serveur Express). Ce qui manque est le CHAÎNON : que
 * app.ts passe bien la variable et non un littéral. Aucun test unitaire ne monte `createApp`
 * — il arme le transport Redis — donc ce chaînon n'est vérifiable qu'ici.
 */
describe('backend/src/app.ts — confiance accordée à X-Forwarded-For', () => {
  const app = read('backend', 'src', 'app.ts');

  it('lit le nombre de proxys de confiance dans la configuration', () => {
    expect(app).toMatch(/app\.set\('trust proxy', env\.TRUST_PROXY\)/);
  });

  it('ne fait jamais confiance en dur', () => {
    // `trust proxy` à une valeur codée fait de `req.ip` — clé de tous les limiteurs et
    // adresse du journal d'audit — un en-tête fourni par l'appelant.
    expect(app).not.toMatch(/app\.set\('trust proxy',\s*(?:1|true|'[^']*')\)/);
  });
});

describe('.env.example', () => {
  const sample = read('.env.example');
  const documented = documentedVariables(sample);
  const variables = schemaVariables(read('backend', 'src', 'config', 'env.ts'));

  // Posées par docker-compose à partir de la topologie interne : les renseigner dans .env
  // n'aurait aucun effet. Elles restent expliquées en commentaire, pas en ligne réglable.
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
    // Une variable vide n'est pas une variable absente : `SMTP_HOST=` ferait croire au
    // backend qu'un serveur d'envoi est configuré.
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
      // Le défaut `gzip_proxied off` ne compresserait aucune réponse proxifiée.
      expect(conf).toMatch(/^gzip_proxied /m);
      for (const type of ['application/javascript', 'text/css', 'application/json', 'image/svg+xml']) {
        expect(conf, type).toContain(type);
      }
      // Déjà compressés : les gzipper coûterait du CPU pour rien.
      expect(conf).not.toContain('font/woff2');
    });

    it(`fige les assets hachés par Vite (${name})`, () => {
      // Le bloc filtre sur l'EXTENSION, pas sur le préfixe : `location ^~ /assets/` capturait
      // aussi la route applicative `/assets/:id` (fiche d'asset) et la terminait en 404.
      expect(conf).toMatch(/location ~ \^\/assets\/\.\+\\.\(/);
      expect(conf).not.toMatch(/location \^~ \/assets\/ \{/);
      expect(conf).toMatch(/expires 1y;/);
      expect(conf).toMatch(/add_header Cache-Control "public, immutable" always;/);
    });

    it(`ne masque aucune route de l'application par un répertoire du build (${name})`, () => {
      // Le frontal de production proxifie tout : il n'a pas de `try_files`, donc seules les
      // assertions de résolution de répertoire concernent la configuration du conteneur.
      if (!conf.includes('try_files')) return;
      // `try_files $uri $uri/ /index.html` faisait gagner le RÉPERTOIRE sur la route : `/docs`
      // (matérialisé par le prebuild de la documentation) partait en redirection d'index —
      // absolue, reconstruite sur le port interne, donc port public perdu — puis en 403.
      // Toute URL de doc saisie, partagée, mise en favori ou rechargée était morte.
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
      // « Pas de limite » au niveau `server` était hérité par toutes les `location`. Or seule
      // celle qui streame vers MinIO pose `proxy_request_buffering off` : ailleurs, nginx écrit
      // l'INTÉGRALITÉ du corps dans un fichier temporaire (la couche inscriptible du conteneur,
      // le disque des volumes de données) avant d'ouvrir la connexion vers le backend. Vingt
      // POST anonymes alimentés au goutte-à-goutte remplissaient le disque sans aucun compte,
      // et `express.json({ limit: '2mb' })` n'avait jamais son mot à dire.
      expect(outsideLocations(conf)).toMatch(/^\s*client_max_body_size \d+[kKmMgG];$/m);
      for (const [header, body] of locationBlocks(conf)) {
        if (!/client_max_body_size\s+0;/.test(body)) continue;
        expect(body, `location ${header}`).toMatch(/proxy_request_buffering off;/);
      }
    });

    it(`n'ouvre pas le WebSocket à tout l'internet dans la CSP (${name})`, () => {
      // Un schéma nu (`ws:`/`wss:`) dans une source-list autorise TOUT hôte sur ce schéma :
      // la politique refusait `fetch('https://evil.example')` mais laissait passer
      // `new WebSocket('wss://evil.example')` — les jetons vivent en localStorage. Socket.io
      // se connecte à l'origine, et `'self'` couvre déjà ws/wss de même origine (CSP 3).
      for (const directive of conf.matchAll(/connect-src ([^;"]+)/g)) {
        expect(directive[1].split(/\s+/), directive[0]).not.toContain('ws:');
        expect(directive[1].split(/\s+/), directive[0]).not.toContain('wss:');
      }
    });
  }

  it('laisse à /api/ le temps de répondre, des deux côtés du proxy', () => {
    // Le conteneur frontend est la porte d'entrée réelle de la pile docker seule : ce qui
    // manque ici ne manque nulle part ailleurs. Sans ces délais, le défaut nginx de 60 s
    // coupait la réponse en 504 pendant que Node poursuivait son travail jusqu'au bout —
    // requête payée en entier, puis jetée, et l'utilisateur recharge par-dessus.
    for (const [name, conf] of Object.entries(configs)) {
      const api = locationBlocks(conf).get('/api/');
      expect(api, `${name} : bloc /api/`).toBeDefined();
      expect(api, name).toMatch(/proxy_read_timeout 300s;/);
      expect(api, name).toMatch(/proxy_send_timeout 300s;/);
      // Le backend en déduit le schéma d'origine : les deux configurations doivent le dire.
      expect(api, name).toMatch(/proxy_set_header X-Forwarded-Proto \$scheme;/);
    }
  });

  it("n'annonce une bascule de protocole que lorsque le client en demande une", () => {
    // `Connection 'upgrade'` posé en dur sur /api/ annonçait un changement de protocole à
    // chaque requête ordinaire. La forme correcte est une table `map $http_upgrade`.
    const conf = configs['frontend/nginx.conf'];
    expect(conf).toMatch(/map \$http_upgrade \$connection_upgrade \{/);
    expect(conf).not.toMatch(/proxy_set_header Connection ['"]upgrade['"];/);
  });
});

/**
 * Surcouche de production : le frontal TLS est le SEUL service exposé.
 *
 * Ce qui manque ici ne manque nulle part ailleurs — un cache sans volume écrit sur le
 * disque des volumes de données, et un nginx bloqué sans sonde reste « running ».
 */
describe('docker-compose.prod.yml — frontal TLS', () => {
  const prod = read('docker-compose.prod.yml');
  const conf = read('nginx', 'nginx.conf');

  it('donne un volume au cache déclaré par proxy_cache_path', () => {
    // 2 Go de rotation d'écriture permanente atterrissaient dans la couche inscriptible du
    // conteneur, c'est-à-dire /var/lib/docker — le système de fichiers de pgdata et
    // miniodata — et repartaient à zéro à chaque `scripts/update.sh`.
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
    // La sonde doit viser une `location` servie par nginx lui-même : viser `/` ferait
    // dépendre la santé du frontal de celle du backend.
    expect([...locationBlocks(conf).keys()]).toContain(`= ${probe[1]}`);
    expect(locationBlocks(conf).get(`= ${probe[1]}`)).toMatch(/return 200/);
  });

  it('ne laisse pas un `return` de niveau serveur court-circuiter la sonde', () => {
    // Constaté : un `return 301` posé au niveau `server` s'exécute à la phase de
    // réécriture, AVANT le choix de la location — la sonde partait en 301 et le
    // healthcheck suivait la redirection jusqu'à un échec TLS.
    expect(outsideLocations(conf)).not.toMatch(/^\s*return 301 /m);
    expect(conf).toMatch(/location \/ \{\n\s*return 301 https:\/\/\$host\$request_uri;/);
  });

  it("n'expose la sonde qu'à la boucle locale", () => {
    // `allow`/`deny` seraient sans effet : ils s'évaluent après la phase de réécriture, où
    // `return` a déjà répondu (constaté : 200 depuis une autre adresse).
    const healthz = locationBlocks(conf).get('= /healthz');
    expect(healthz).toMatch(/if \(\$remote_addr !~/);
    expect(healthz).not.toMatch(/allow /);
  });
});

/**
 * Image d'exécution du backend — INFRA-09.
 *
 * Mesuré sur l'image construite : uid 0 → uid 1000, six binaires de développement
 * (vitest, eslint, tsc, tsx, prettier) → zéro, toutes les sources .ts → zéro,
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
    // `npm install` réécrit l'arbre : deux images bâties à deux dates n'exécutent pas le
    // même code. Et les devDependencies, ce sont tsx et le compilateur TypeScript dans
    // l'image qui traite des fichiers déposés par des utilisateurs.
    expect(dockerfile).not.toMatch(/^RUN npm install$/m);
    expect(stages[0]).toMatch(/npm ci/);
    expect(runtime).toMatch(/npm ci --omit=dev/);
  });

  it('n’embarque pas les sources dans l’image finale', () => {
    expect(runtime).not.toMatch(/^COPY \. \.$/m);
    expect(runtime).toMatch(/^COPY --from=build \/app\/dist \.\/dist$/m);
    // Ressources du worker résolues à l'exécution sous src/ : tsc ne les copie pas.
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
    // En devDependency, `npm ci --omit=dev` l'élaguerait et `migrate deploy` échouerait au
    // premier démarrage du conteneur.
    expect(Object.keys(pkg.dependencies)).toContain('prisma');
    expect(Object.keys(pkg.devDependencies)).not.toContain('prisma');
    expect(startSh).toContain('npx prisma migrate deploy');
  });

  it('ne régénère pas le client Prisma à chaque démarrage', () => {
    // Une dizaine de secondes à chaque reprise de `restart: always` — et un échec net
    // depuis que le conteneur tourne en uid 1000 : node_modules appartient à root.
    expect(startSh).toMatch(/if \[ -d node_modules\/\.prisma\/client \]; then/);
  });

  it('livre un seed exécutable sans tsx, que l’image ne contient plus', () => {
    // `docker compose exec backend npm run seed` est documenté (first-run.md) : il doit
    // continuer à fonctionner alors que tsx a quitté l'image.
    expect(pkg.scripts.seed).toBe('node dist/seed.js');
    expect(pkg.scripts.build).toContain('build:seed');
  });
});

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

import { readFileSync } from 'node:fs';
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
      expect(conf).toMatch(/location \^~ \/assets\/ \{/);
      expect(conf).toMatch(/expires 1y;/);
      expect(conf).toMatch(/add_header Cache-Control "public, immutable" always;/);
    });
  }

  it('ne cache jamais index.html (il pointe vers les assets hachés)', () => {
    const conf = configs['frontend/nginx.conf'];
    expect(conf).toMatch(/location = \/index\.html \{[\s\S]*?Cache-Control "no-cache"/);
  });
});

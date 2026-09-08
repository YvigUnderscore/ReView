// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { isLoopbackEndpoint } from './publicEndpoint';

describe('isLoopbackEndpoint', () => {
  /**
   * Le cas qui a coûté une session : `docker compose up` sans passer par `install.sh` laisse
   * `S3_PUBLIC_ENDPOINT` à `http://localhost:9000`, et l'upload échoue en silence dès qu'on
   * ouvre ReView depuis une autre machine du réseau.
   */
  it('reconnaît le défaut de la stack docker', () => {
    expect(isLoopbackEndpoint('http://localhost:9000')).toBe(true);
  });

  it('reconnaît tout le /8 de bouclage, pas seulement 127.0.0.1', () => {
    expect(isLoopbackEndpoint('http://127.0.0.1:9000')).toBe(true);
    expect(isLoopbackEndpoint('http://127.0.1.1:9000')).toBe(true);
    expect(isLoopbackEndpoint('http://127.255.255.254/')).toBe(true);
  });

  it('reconnaît les formes IPv6, crochets compris', () => {
    expect(isLoopbackEndpoint('http://[::1]:9000')).toBe(true);
    expect(isLoopbackEndpoint('http://[0:0:0:0:0:0:0:1]:9000')).toBe(true);
    expect(isLoopbackEndpoint('http://[::ffff:127.0.0.1]:9000')).toBe(true);
  });

  // « Toutes les interfaces » n'est pas du bouclage, mais n'est pas davantage une adresse
  // qu'un navigateur puisse appeler : le même avertissement s'impose.
  it('traite « toutes les interfaces » comme inutilisable côté navigateur', () => {
    expect(isLoopbackEndpoint('http://0.0.0.0:9000')).toBe(true);
    expect(isLoopbackEndpoint('http://[::]:9000')).toBe(true);
  });

  it('laisse passer une adresse que le réseau peut joindre', () => {
    expect(isLoopbackEndpoint('http://192.168.1.115:9000')).toBe(false);
    expect(isLoopbackEndpoint('https://stockage.studio.example')).toBe(false);
    expect(isLoopbackEndpoint('http://minio:9000')).toBe(false);
    // 127 ailleurs que dans le premier octet n'est pas du bouclage.
    expect(isLoopbackEndpoint('http://10.127.0.1:9000')).toBe(false);
    expect(isLoopbackEndpoint('http://192.168.127.1:9000')).toBe(false);
  });

  // Un hôte qui se termine par « localhost » est réservé au bouclage (RFC 6761).
  it('prend en compte les sous-domaines de localhost', () => {
    expect(isLoopbackEndpoint('http://minio.localhost:9000')).toBe(true);
    // …mais pas un domaine qui contient seulement le mot.
    expect(isLoopbackEndpoint('http://localhost.studio.example')).toBe(false);
  });

  it('se tait sur une valeur absente ou illisible — ce n’est pas son sujet', () => {
    expect(isLoopbackEndpoint(undefined)).toBe(false);
    expect(isLoopbackEndpoint(null)).toBe(false);
    expect(isLoopbackEndpoint('')).toBe(false);
    expect(isLoopbackEndpoint('pas une url')).toBe(false);
  });
});

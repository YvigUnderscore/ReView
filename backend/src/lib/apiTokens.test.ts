// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import {
  API_TOKEN_PREFIX,
  generateApiToken,
  hashApiToken,
  isApiTokenFormat,
  isWriteMethod,
} from './apiTokens';

describe('apiTokens', () => {
  it('génère un token rvk_ de 40 hex avec son hash sha256', () => {
    const { token, tokenHash } = generateApiToken();
    expect(token).toMatch(/^rvk_[0-9a-f]{40}$/);
    expect(tokenHash).toBe(hashApiToken(token));
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('deux générations ne se ressemblent pas', () => {
    expect(generateApiToken().token).not.toBe(generateApiToken().token);
  });

  it('reconnaît le format token API vs JWT', () => {
    expect(isApiTokenFormat(API_TOKEN_PREFIX + 'abc')).toBe(true);
    expect(isApiTokenFormat('eyJhbGciOi...')).toBe(false);
  });

  it('classe les méthodes lecture/écriture', () => {
    expect(isWriteMethod('GET')).toBe(false);
    expect(isWriteMethod('head')).toBe(false);
    expect(isWriteMethod('OPTIONS')).toBe(false);
    expect(isWriteMethod('POST')).toBe(true);
    expect(isWriteMethod('PATCH')).toBe(true);
    expect(isWriteMethod('DELETE')).toBe(true);
  });
});

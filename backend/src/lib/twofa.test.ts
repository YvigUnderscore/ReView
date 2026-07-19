import { describe, it, expect } from 'vitest';
import {
  generateTotpSecret,
  otpauthUri,
  currentTotp,
  verifyTotp,
  generateBackupCodes,
  consumeBackupCode,
} from './twofa';

describe('twofa', () => {
  it('un code généré depuis le secret est accepté, un mauvais refusé', async () => {
    const secret = generateTotpSecret();
    const code = await currentTotp(secret);
    await expect(verifyTotp(secret, code)).resolves.toBe(true);
    await expect(verifyTotp(secret, ` ${code} `)).resolves.toBe(true); // espaces tolérés
    await expect(verifyTotp(secret, '000000')).resolves.toBe(false);
    await expect(verifyTotp(secret, 'abc')).resolves.toBe(false);
  });

  it("l'URI otpauth contient l'émetteur et le compte", () => {
    const uri = otpauthUri('a@b.c', 'ReView Studio', generateTotpSecret());
    expect(uri.startsWith('otpauth://totp/')).toBe(true);
    expect(uri).toContain('ReView%20Studio');
    expect(uri).toContain('a%40b.c');
  });

  it('codes de secours : 10 uniques, consommés un par un, insensibles à la casse', () => {
    const { plain, hashes } = generateBackupCodes();
    expect(new Set(plain).size).toBe(10);
    expect(hashes).toHaveLength(10);
    const rest = consumeBackupCode(hashes, plain[3]!.toUpperCase());
    expect(rest).toHaveLength(9);
    // Un code consommé ne repasse pas.
    expect(consumeBackupCode(rest!, plain[3]!)).toBeNull();
    expect(consumeBackupCode(hashes, 'inconnu')).toBeNull();
  });
});

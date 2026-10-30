// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Normalisation of email addresses on write.
 *
 * The email is both the login identifier AND the matching key of OIDC SSO (which always receives a
 * lowercase address from the provider). Without normalisation, `Alice@studio.com` and `alice@studio.com`
 * would be two distinct accounts the uniqueness constraint does not match: two identities for one person,
 * and an SSO match landing on the wrong one. Every address is therefore normalised when written.
 *
 * Deliberately conservative: lowercase + surrounding spaces removed. No removal of dots or `+tag`
 * sub-addresses — those rules are specific to some providers and would wrongly merge legitimately distinct
 * addresses.
 */
export const normalizeEmail = (email: string): string => email.trim().toLowerCase();
